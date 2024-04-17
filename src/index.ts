import express from 'express';
import sharp from "sharp";
import axios from "axios";
import fs from "fs";
const amqp = require('amqplib/callback_api');

import { PrismaClient } from "@prisma/client";
import { Image } from '@prisma/client';
import cors from 'cors';

import productRouter from './routes/product.router';
import imageRouter from './routes/image.router';
import compressRouter from './routes/compress.router';

const app = express();
const port = process.env.PORT || 8080;
const db = new PrismaClient();

// app.use(express.json())

const getRawBody = require('raw-body')
const crypto = require('crypto')
const secretKey = 'a1652530377ea8a602862f39dd54b2bb745b62cdf32427bba12dc79e9116b625'

app.use(cors());
app.options('*', cors());

app.use("/products", productRouter);
app.use("/images", imageRouter);
// app.use('/compress-image', compressRouter);

app.get("/", (req, res) => {
    res.json({ message: "demo response" }).status(200)
})


app.post("/webhooks/product/create", async (req, res) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256')

    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', secretKey)
        .update(body, 'utf8', 'hex')
        .digest('base64')


    if (hmac === hash) {
        try {
            req.body = JSON.parse(body.toString());
            const productData = req.body;
            const { id, title } = productData;
            const productId = id.toString();

            const product = await db.product.create({
                data: {
                    id: productId,
                    title
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
        .createHmac('sha256', secretKey)
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
                const { id: imageId, src: url, width, height } = image;
                const imageIdStr = imageId.toString();
            
                const existingImage = await db.image.findUnique({
                    where: { id: imageIdStr },
                });
            
                if (existingImage) {
                    let data:Image = {
                        id: imageIdStr,
                        url,
                        productId: existingImage.productId,
                        status: existingImage.status
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
                    let data:Image = {
                        id: imageIdStr,
                        url,
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

app.post("/webhooks/product/delete", async (req, res) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256')

    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', secretKey)
        .update(body, 'utf8', 'hex')
        .digest('base64')


    if (hmac === hash) {
        try {
            req.body = JSON.parse(body.toString());
            const productData = req.body;
            console.log("web hooks deletion : ", productData)
        } catch (e) {
            res.status(500).json({ error: 'An error occurred while storing product data.' });
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
            const { id, productid, url } = data;

            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');

            const compressedBuffer = await sharp(buffer).resize(300, 300).jpeg({ quality: 60 }).toBuffer();

            fs.writeFileSync('hello.jpg', compressedBuffer);

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

            const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': `${process.env.SHOPIFY_ADMIN_ACCESS_TOKEN}`
                },
                body: JSON.stringify({ image })
            })


            const data = await response.json();

            const deleteImage = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productid}/images/${id}.json`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': `${process.env.SHOPIFY_ADMIN_ACCESS_TOKEN}`
                },
            })

            const deleteImageRes = await deleteImage.json();


            const removeImageFromCustomDB = await db.image.delete({
                where: {
                    id
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

