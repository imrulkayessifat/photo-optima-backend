import express from 'express';
import sharp from "sharp";
import axios from "axios";

const amqp = require('amqplib/callback_api');
const nonce = require("nonce");
const cookie = require("cookie");

import { PrismaClient } from "@prisma/client";
import { Image } from '@prisma/client';
import cors from 'cors';

import imageRouter from './routes/image.router';

const app = express();
const port = process.env.PORT || 8080;
const db = new PrismaClient();


const getRawBody = require('raw-body')
const crypto = require('crypto')

const webhooks_secret_key = process.env.WEBHOOKS_SECRET_KEY;
const client_id = process.env.SHOPIFY_CLIENT_ID;
const scopes = "read_orders";
const forwardingAddress = process.env.FORWARDING_ADDRESS;

app.use(cors());
app.options('*', cors());

app.use("/images", imageRouter);

interface AccessTokenType {
    access_token: string;
    scope: string;
}

app.get("/shopify", (req, res) => {
    const shopName = req.query.shop;
    if (shopName) {

        const shopState = nonce();

        const redirectURL = forwardingAddress + "/shopify/callback";

        // install url for app install
        const installUrl =
            "https://" +
            shopName +
            "/admin/oauth/authorize?client_id=" +
            client_id +
            "&scope=" +
            scopes +
            "&state=" +
            shopState +
            "&redirect_uri=" +
            redirectURL +
            "&grant_options[]=per-user";

        res.cookie("state", shopState);
        // redirect the user to the installUrl
        res.redirect(installUrl);
    } else {
        return res.status(400).send('Missing "Shop Name" parameter!!');
    }
})

function verifyHmac(queryParams: any) {
    const { hmac, ...params } = queryParams;
    const sortedParams = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');

    const calculatedHmac = crypto
        .createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET)
        .update(sortedParams)
        .digest('hex');

    return hmac === calculatedHmac;
}

app.get("/shopify/callback", async (req, res) => {
    const { shop, hmac, code, shopState } = req.query;
    const stateCookie = cookie.parse(req.headers.cookie).shopState;

    if (shopState !== stateCookie) {
        return res.status(400).send("request origin cannot be found");
    }

    const validation = verifyHmac(req.query)

    if (!validation) {
        return res.status(400).send("HMAC validation failed");
    }

    const accessTokenPayload = {
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        code,
    };

    const getAccessToken = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(accessTokenPayload)
    })

    const getAccessTokenRes = await getAccessToken.json();

    const productsReq = await fetch(`https://${shop}/admin/api/2024-04/products.json`, {
        headers: {
            'X-Shopify-Access-Token': `${getAccessTokenRes.access_token}`,
        },
    })

    const productRes = await productsReq.json();

    const storeCount = await db.store.findMany({
        where: {
            name: `${shop}`
        }
    })

    if (storeCount.length === 0) {
        await db.store.create({
            data: {
                name: `${shop}`
            }
        })
    }



    productRes.products.map((product: { images: any[]; }) => {
        product.images.map(async (image: any) => {
            const getImage = await db.image.findFirst({
                where: {
                    id: `${image.id}`
                }
            })
            if (!getImage) {
                await db.image.create({
                    data: {
                        id: `${image.id}`,
                        productId: `${image.product_id}`,
                        url: image.src
                    }
                })
            }

        })
    })

    if (getAccessTokenRes.scope.includes('write_products')) {
        res.redirect(`${process.env.FRONTEND_DOMAIN}?shop=${shop}&access_token=${getAccessTokenRes.access_token}`);
        // res.status(200).json({ data: getAccessTokenRes });
    } else {
        console.error("Access token doesn't have write_products scope:", getAccessTokenRes.access_token);
        return res.status(403).send("Access token doesn't have necessary scopes");
    }

})

app.post("/webhooks/product/create", async (req, res) => {
    const shopDomain = req.get('x-shopify-shop-domain')
    const hmac = req.get('X-Shopify-Hmac-Sha256')

    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')


    if (hmac === hash) {
        try {
            req.body = JSON.parse(body.toString());
            const productData = req.body;
            const { id, title } = productData;
            const productId = id.toString();


            const storeCount = await db.store.findMany({
                where: {
                    name: shopDomain
                }
            })

            if (storeCount.length === 0) {
                await db.store.create({
                    data: {
                        name: shopDomain!
                    }
                })
            }

            const product = await db.product.create({
                data: {
                    id: productId,
                    storename: shopDomain!,
                    title,
                }
            })

            res.status(201).json({ data: product });
        } catch (e) {
            res.status(500).json({ error: 'An error occurred while storing product data.' });
        }
    } else {
        res.status(403).json({ error: "you don't have access" })
    }

})

app.post("/webhooks/product/update", async (req, res) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256')

    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')

    if (hmac === hash) {
        try {
            req.body = JSON.parse(body.toString());
            const productData = req.body;
            const { id, title, images } = productData;


            const productId = id.toString();

            let responses = [];

            for (const image of images) {
                const { id: imageId, src: url, width, height,alt } = image;
                const imageIdStr = imageId.toString();

                const existingImage = await db.image.findUnique({
                    where: { id: imageIdStr },
                });

                const newUrl = new URL(url);
                const name = newUrl.pathname.split('/').pop() || null;


                if (existingImage) {
                    let data: Image = {
                        id: imageIdStr,
                        url,
                        productId: existingImage.productId,
                        status: existingImage.status,
                        name: existingImage.name,
                        alt:existingImage.alt
                    };
                    if (width === 300 && height === 300) {
                        data.status = 'COMPRESSED';
                    }
                    const response = await db.image.update({
                        where: { id: imageIdStr },
                        data,
                    });
                    responses.push(response);
                } else {
                    let data: Image = {
                        id: imageIdStr,
                        url,
                        name,
                        alt,
                        productId,
                        status: 'NOT_COMPRESSED'
                    };
                    if (width === 300 && height === 300) {
                        data.status = 'COMPRESSED';
                    }
                    const response = await db.image.create({
                        data,
                    });
                    responses.push(response);
                }
            }


            res.status(200).json({ data: responses });

        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'An error occurred while updating product data.' });
        }
    } else {
        res.status(403).json({ error: "you don't have access" })
    }
})

amqp.connect('amqp://localhost', function (error0: any, connection: { createChannel: (arg0: (error1: any, channel: any) => void) => void; }) {
    if (error0) {
        throw error0;
    }
    connection.createChannel(function (error1, channel) {
        if (error1) {
            throw error1;
        }

        const queue = 'shopify_to_compressor';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const data = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, productid, url, storeName } = data;

            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');

            const megabytes = (buffer.length / 1024) / 1024;

            const compressedBuffer = await sharp(buffer).resize(300, 300).jpeg({ quality: 60 }).toBuffer();

            // fs.writeFileSync('hello.jpg', compressedBuffer);

            const subscriptionPlan = {
                "FREE": 25,
                "MICRO": 500,
                "PRO": 2048,
                "ADVANCED": 5120
            }

            // Update the status in the database
            const updatedImage = await db.image.update({
                where: { id: id },
                data: { status: 'COMPRESSED' },
            });

            const store = await db.store.findMany({
                where: {
                    name: storeName
                }
            })

            if (store.length > 0 && store[0].dataUsed !== null) {
                const usedData = megabytes + store[0].dataUsed
                const updatedData = await db.store.update({
                    where: {
                        name: storeName
                    },
                    data: {
                        dataUsed: usedData
                    }
                })

                const accessTokenResponse = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        'client_id': `${process.env.SHOPIFY_CLIENT_ID}`,
                        'client_secret': `${process.env.SHOPIFY_CLIENT_SECRET}`,
                        'grant_type': 'client_credentials'
                    })
                })

                const accessToken = await accessTokenResponse.json() as AccessTokenType;

                if (subscriptionPlan[updatedData.plan] < updatedData.dataUsed!) {

                    await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/recurring_application_charges/${updatedData.chargeId}.json`, {
                        method: 'DELETE',
                        headers: {
                            'X-Shopify-Access-Token': `${accessToken.access_token}`
                        },
                    })

                }
            }


            const uploadImage = await fetch('http://localhost:3001/upload-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, productid, compressedBuffer })
            })

        }, {
            noAck: true
        });
    });

    connection.createChannel(function (error1, channel) {
        if (error1) {
            throw error1;
        }

        const queue = 'compressor_to_uploader';

        channel.assertQueue(queue, {
            durable: false
        });

        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const content = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, productid, compressedBuffer } = content;


            const base64Image = Buffer.from(compressedBuffer).toString('base64');

            const image = {
                product_id: productid,
                attachment: base64Image,
            };

            const accessTokenResponse = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    'client_id': `${process.env.SHOPIFY_CLIENT_ID}`,
                    'client_secret': `${process.env.SHOPIFY_CLIENT_SECRET}`,
                    'grant_type': 'client_credentials'
                })
            })

            const accessToken = await accessTokenResponse.json() as AccessTokenType;

            const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': `${accessToken.access_token}`
                },
                body: JSON.stringify({ image })
            })


            const data = await response.json();

            // console.log(productid, id)

            const deleteImage = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images/${id}.json`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': `${accessToken.access_token}`
                },
            })

            const deleteImageRes = await deleteImage.json();

            const removeImageFromCustomDB = await db.image.delete({
                where: {
                    id: `${id}`
                }
            })

        }, {
            noAck: true
        });
    });

    connection.createChannel(function (error1, channel) {
        if (error1) {
            throw error1;
        }

        const queue = 'periodic_update';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const data = JSON.parse(msg.content.toString());
            const { id, productid, url } = data;

            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');

            const compressedBuffer = await sharp(buffer).resize(300, 300).jpeg({ quality: 60 }).toBuffer();

            // Update the status in the database
            const updatedImage = await db.image.update({
                where: { id: id },
                data: { status: 'COMPRESSED' },
            });

            const uploadImage = await fetch('http://localhost:3001/upload-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, productid, compressedBuffer })
            })

        }, {
            noAck: true
        });
    });
});

app.listen(port, () => {
    console.log(`server up and running on port: ${port}`)
})
