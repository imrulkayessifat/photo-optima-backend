import express from 'express';
import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

import productRouter from './routes/product.router';
import imageRouter from './routes/image.router';

const app = express();
const port = process.env.PORT || 8080;
const db = new PrismaClient();

// app.use(express.json())

const getRawBody = require('raw-body')
const crypto = require('crypto')
const secretKey = 'a1652530377ea8a602862f39dd54b2bb745b62cdf32427bba12dc79e9116b625'

app.use("/products", productRouter);
app.use("/images", imageRouter);

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
                const { id: imageId, src: url } = image;
                const imageIdStr = imageId.toString();

                const existingImage = await db.image.findUnique({
                    where: { id: imageIdStr },
                });

                if (existingImage) {
                    const response = await db.image.update({
                        where: { id: imageIdStr },
                        data: { url },
                    });
                    responses.push(response);
                } else {
                    const response = await db.image.create({
                        data: {
                            id: imageIdStr,
                            url,
                            productId,
                        },
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



app.listen(port, () => {
    console.log(`server up and running on port: ${port}`)
})