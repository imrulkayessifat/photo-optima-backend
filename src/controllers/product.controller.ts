import { Status } from '@prisma/client';
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { io } from '../index';

const crypto = require('crypto')

const db = new PrismaClient();
const getRawBody = require('raw-body')

const webhooks_secret_key = process.env.WEBHOOKS_SECRET_KEY;
const app_secret = process.env.SHOPIFY_CLIENT_SECRET;

const verifyRequest = async (req: Request) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = await getRawBody(req);
    const hash = crypto
        .createHmac('sha256', app_secret)
        .update(body, 'utf8', 'hex')
        .digest('base64');
    if (hmac !== hash) {
        throw new Error("Unauthorized");
    }
    req.body = JSON.parse(body.toString());
    return req.body;
};

export const productCreate = async (req: any, res: any) => {
    try {
        console.log("webhook check ", "product create")
        const body = await verifyRequest(req);;
        const { id, title } = body;
        const productId = id.toString();
        const shopDomain = req.get('x-shopify-shop-domain');

        const storeExist = await db.store.findFirst({ where: { name: shopDomain } });
        if (!storeExist) {
            await db.store.create({ data: { name: shopDomain! } });
        }

        const productExists = await db.product.findFirst({ where: { id: productId } });
        if (productExists) {
            return res.status(409).json({ error: "Product already exists" });
        }

        const product = await db.product.create({
            data: { id: productId, storename: shopDomain!, title }
        });

        res.status(201).json({ data: product });
    } catch (error) {
        if (error.message === "Unauthorized") {
            return res.status(403).json({ error: "Unauthorized access" });
        }
        console.error(error);
        res.status(500).json({ error: 'An error occurred while storing product data.' });
    }
}

export const productUpdate = async (req: Request, res: Response): Promise<void> => {
    try {

        const hmac = req.get('X-Shopify-Hmac-Sha256')
        const shopDomain = req.get('x-shopify-shop-domain')

        console.log("webhook shop domain ", shopDomain)

        const body = await getRawBody(req)

        const hash = crypto
            .createHmac('sha256', app_secret)
            .update(body, 'utf8', 'hex')
            .digest('base64')

        console.log("hmac === hash", hmac === hash)

        if (hmac === hash) {
            try {
                req.body = JSON.parse(body.toString());
                const productData = req.body;
                const { id, title, images, alt } = productData;

                const productId = id.toString();

                const productInput = {
                    id_storename: {
                        id: productId,
                        storename: shopDomain,
                    },
                };

                await db.product.update({
                    where: productInput,
                    data: {
                        product_vendor: productData.vendor,
                        variant_title: productData.variants[0].title,
                        product_page_title: productData.options[0].name,
                        product_type: productData.product_type,
                        product_barcode: productData.variants[0].barcode,
                        product_title: productData.title,
                        product_sku: productData.variants[0].sku,
                    }
                })

                for (const image of images) {
                    const { id: imageId, src: url, width, height, alt } = image;
                    const imageIdStr = imageId.toString();

                    console.log("image log", image)
                    console.log("alt", alt)

                    const newUrl = new URL(url);
                    const name = newUrl.pathname.split('/').pop() || null;
                    console.log("name", name)

                    let responses = []


                    if (alt !== null && alt.split('.')[0].split('-').pop().slice(-1) === 'C') {
                        const response = await db.image.update({
                            where: {
                                uid: parseInt(alt.split('.')[0].split('-').pop().split('C').join(''))
                            },
                            data: {
                                id: imageIdStr,
                                url: url,
                                name: alt || name,
                                // alt: alt || name,
                                // fileRename: false,
                                // altRename: false,
                                productId,
                                status: 'COMPRESSED'
                            }
                        })
                        responses.push(response);
                    } else if (alt !== null && alt.split('.')[0].split('-').pop().slice(-1) === 'N') {
                        const response = await db.image.update({
                            where: {
                                uid: parseInt(alt.split('.')[0].split('-').pop().split('N').join(''))
                            },
                            data: {
                                id: imageIdStr,
                                url: url,
                                name: alt || name,
                                // alt: alt || name,
                                // fileRename: false,
                                // altRename: false,
                                productId,
                                status: 'NOT_COMPRESSED'
                            }
                        })
                        responses.push(response);
                    } else {

                        const imageExit = await db.image.findFirst({
                            where: {
                                id: imageIdStr
                            }
                        })

                        if (!imageExit) {
                            const response = await db.image.create({
                                data: {
                                    id: imageIdStr,
                                    url,
                                    name: alt || name,
                                    alt: alt || name,
                                    fileRename: false,
                                    altRename: false,
                                    productId,
                                    status: 'NOT_COMPRESSED',
                                    storename: shopDomain
                                },
                            });
                            responses.push(response);
                        }

                    }

                    io.emit('image_model', () => {
                        console.log('an event occured in shopify product image upload');
                    });

                    const storeRes = await db.store.findFirst({
                        where: {
                            name: shopDomain
                        }
                    })

                    if (storeRes.autoCompression) {
                        const imageRes = await db.image.findFirst({
                            where: {
                                id: imageIdStr
                            }
                        })
                        if (imageRes.status === 'NOT_COMPRESSED') {
                            const response = fetch(`${process.env.MQSERVER}/image/compress-image`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    uid: imageRes.uid,
                                    productid: imageRes.productId,
                                    url: imageRes.url,
                                    storeName: shopDomain
                                })
                            });
                        }
                    }
                    if (storeRes.autoFileRename) {
                        const imageRes = await db.image.findFirst({
                            where: {
                                id: imageIdStr
                            }
                        })

                        if (imageRes.id) {
                            const req = fetch(`${process.env.MQSERVER}/rename/file-rename`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    storeName: shopDomain,
                                    id: `${imageRes.id}`,
                                })
                            })
                        }
                    }

                    if (storeRes.autoAltRename) {
                        const imageRes = await db.image.findFirst({
                            where: {
                                id: imageIdStr
                            }
                        })

                        if (imageRes.id) {
                            const req = fetch(`${process.env.MQSERVER}/rename/alt-rename`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    storeName: shopDomain,
                                    id: `${imageRes.id}`,
                                })
                            })
                        }
                    }
                }


                res.status(200).json({ data: [] });

            } catch (e) {
                console.error(e);
                res.status(500).json({ error: 'An error occurred while updating product data.' });
            }
        } else {
            res.status(403).json({ error: "you don't have access" })
        }
    } catch (e) {
        res.status(400).json({ error: 'something went wrong!' })
    }
}