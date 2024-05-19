import cors from 'cors';
import http from 'http';
import axios from "axios";
import sharp from "sharp";
import express from 'express';
import bodyParser from 'body-parser'
import { uploadFile } from '@uploadcare/upload-client'

import { PrismaClient } from "@prisma/client";

import { AccessTokenType } from 'types/type';
import shopifyRouter from './routes/shopify.router';
import productRouter from './routes/product.router';
import fileUploadRouter from './routes/file-upload.router';

const amqp = require('amqplib/callback_api');

const app = express();
const server = http.createServer(app)
const port = process.env.PORT || 8080;
const db = new PrismaClient();

app.use(cors());
app.options('*', cors());
// app.use(bodyParser.json());

app.use("/shopify", shopifyRouter)
app.use("/webhooks/product", productRouter)
app.use("/webhooks/file", fileUploadRouter)


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

            const compressedBuffer = await sharp(buffer).jpeg({ quality: 60 }).toBuffer();

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


            const uploadImage = await fetch('http://localhost:3001/image/upload-image', {
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

        const queue = 'auto_compression';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const data = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, productId: productid, url, store_name: storeName } = data;

            const getStoreData = await db.store.findFirst({
                where: {
                    name: storeName
                }
            })

            if (getStoreData.autoCompression) {
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


                const uploadImage = await fetch('http://localhost:3001/image/upload-image', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id, productid, compressedBuffer })
                })
            }

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

            if (productid !== '1') {
                const image = {
                    alt: 'COMPRESSED',
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

                const getImageData = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images/${id}.json`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': `${accessToken.access_token}`
                    },
                })

                const getImageDataRes = await getImageData.json()

                const response = await axios.get(getImageDataRes.image.src, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data, 'binary');
                const base64ImageForBackup = Buffer.from(buffer).toString('base64');


                const deleteImage = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images/${id}.json`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': `${accessToken.access_token}`
                    },
                })

                if (deleteImage.status === 200) {
                    const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images.json`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': `${accessToken.access_token}`
                        },
                        body: JSON.stringify({ image })
                    })

                    const data = await response.json();

                    await db.backup.create({
                        data: {
                            restoreId: `${data.image.id}`,
                            url: base64ImageForBackup
                        }
                    })

                }


            } else {
                const base64Image2 = Buffer.from(compressedBuffer);

                const getUploadcareImage = await fetch(`https://api.uploadcare.com/files/${id}/storage/`, {
                    headers: {
                        'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                    }
                })

                if (getUploadcareImage.status === 200) {
                    const deleteFileReq = await fetch(`https://api.uploadcare.com/files/${id}/storage/`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                        }
                    })
                    const data = await uploadFile(
                        base64Image2,
                        {
                            publicKey: 'c0bc9dbd97f5de75c062',
                            store: 'auto',
                            metadata: {
                                subsystem: 'js-client',
                                pet: `COMPRESSED_${id}`
                            }
                        }
                    )
                }

            }

            const existImageFromCustomDB = await fetch(`http://localhost:3001/image/${id}`)

            if (existImageFromCustomDB.status === 200) {
                const removeImageFromCustomDB = await fetch(`http://localhost:3001/image/${id}`, {
                    method: 'DELETE'
                })
            }


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

            const uploadImage = await fetch('http://localhost:3001/image/upload-image', {
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

        const queue = 'restore_image';

        channel.assertQueue(queue, {
            durable: false
        });

        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const data = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, productid, url } = data;

            const uploadImage = await fetch('http://localhost:3001/image/restore-upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, productid, url })
            })

        }, {
            noAck: true
        });
    });

    connection.createChannel(function (error1, channel) {
        if (error1) {
            throw error1;
        }

        const queue = 'restore_to_uploader';

        channel.assertQueue(queue, {
            durable: false
        });

        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const content = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, productid, url } = content;


            console.log(id, productid)

            if (productid !== '1') {
                const image = {
                    product_id: productid,
                    attachment: url,
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

                

                const deleteImage = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images/${id}.json`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': `${accessToken.access_token}`
                    },
                })

                if (deleteImage.status === 200) {
                    const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images.json`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': `${accessToken.access_token}`
                        },
                        body: JSON.stringify({ image })
                    })

                    const data = await response.json();

                }


            } else {
                const base64Image2 = url;

                const getUploadcareImage = await fetch(`https://api.uploadcare.com/files/${id}/storage/`, {
                    headers: {
                        'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                    }
                })

                if (getUploadcareImage.status === 200) {
                    const deleteFileReq = await fetch(`https://api.uploadcare.com/files/${id}/storage/`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                        }
                    })
                    const data = await uploadFile(
                        base64Image2,
                        {
                            publicKey: 'c0bc9dbd97f5de75c062',
                            store: 'auto',
                            metadata: {
                                subsystem: 'js-client',
                                pet: `COMPRESSED_${id}`
                            }
                        }
                    )
                }

            }

            const existImageFromCustomDB = await fetch(`http://localhost:3001/image/${id}`)

            if (existImageFromCustomDB.status === 200) {
                const removeImageFromCustomDB = await fetch(`http://localhost:3001/image/${id}`, {
                    method: 'DELETE'
                })
            }


        }, {
            noAck: true
        });
    });
});

server.listen(port, () => {
    console.log(`server up and running on port: ${port}`)
})
