import cors from 'cors';
import http from 'http';
import axios from "axios";
import sharp from "sharp";
import express from 'express';

import bodyParser from 'body-parser'
import { uploadFile } from '@uploadcare/upload-client'

import { PrismaClient } from "@prisma/client";
import { Server } from 'socket.io';
import { Socket } from 'socket.io';

import { AccessTokenType } from 'types/type';
import shopifyRouter from './routes/shopify.router';
import productRouter from './routes/product.router';
import fileUploadRouter from './routes/file-upload.router';
import complianceRouter from './routes/compliance.router';

const amqp = require('amqplib/callback_api');
const fs = require('fs');

const app = express();
const server = http.createServer(app)
export const io = new Server(server, {
    cors: {
        origin: 'https://app.photooptima.com',
        allowedHeaders: ["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"],
        methods: ["GET"],
    }
})
const port = process.env.PORT || 8080;
const db = new PrismaClient();

app.use(cors());
app.options("*", cors());
// app.use(bodyParser.json());

app.use("/shopify", shopifyRouter)
app.use("/webhooks/product", productRouter)
app.use("/webhooks/file", fileUploadRouter)
app.use("/webhooks/compliance", complianceRouter)

app.get("/", (req, res) => {
    res.json({ message: "response from backend" }).status(200);
});

io.on('connection', (socket) => {
    console.log('new client connected from backend server')
    socket.on('disconnect', () => {
        console.log('client disconnected from backend server')
    })
})

amqp.connect('amqp://localhost?frameMax=15728640', function (error0: any, connection: { createChannel: (arg0: (error1: any, channel: any) => void) => void; }) {
    if (error0) {
        console.error('Failed to connect to RabbitMQ', error0);
        process.exit(1);
    }

    // shopify_to_compressor
    connection.createChannel(function (error1, channel) {
        if (error1) {
            console.error('Failed to create shopify_to_compressor channel', error1);
            process.exit(1);
        }

        const queue = 'shopify_to_compressor';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            try {
                const data = JSON.parse(msg.content.toString());
                const { uid, productid, url, storeName } = data;

                const store = await db.store.findFirst({
                    where: { name: storeName }
                });

                if (!store) {
                    console.error('Store not found');
                    return;
                }

                console.log('Single compress for URL:', url);

                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data, 'binary');
                const megabytes = buffer.length / 1024 / 1024;

                let qualifyPercenties;
                const uint8Array = new Uint8Array(buffer);
                const header = uint8Array.subarray(0, 4);

                if (store.compressionType === 'BALANCED') {
                    qualifyPercenties = 80;
                } else if (store.compressionType === 'CONSERVATIVE') {
                    qualifyPercenties = 65;
                } else {
                    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                        qualifyPercenties = store.png;
                    } else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
                        qualifyPercenties = store.jpeg;
                    } else {
                        qualifyPercenties = store.others;
                    }
                }

                const compressedBuffer = await sharp(buffer).jpeg({ quality: qualifyPercenties }).toBuffer();

                if (store.dataUsed !== null) {
                    const usedData = megabytes + store.dataUsed;
                    await db.store.update({
                        where: { name: storeName },
                        data: { dataUsed: usedData }
                    });

                    const accessTokenResponse = await fetch(`https://${storeName}/admin/oauth/access_token`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            'client_id': process.env.SHOPIFY_CLIENT_ID,
                            'client_secret': process.env.SHOPIFY_CLIENT_SECRET,
                            'grant_type': 'client_credentials'
                        })
                    });

                    const accessToken = await accessTokenResponse.json();
                    const subscriptionPlan = await db.subscriptionPlan.findFirst({
                        where: { name: store.plan }
                    });

                    if (subscriptionPlan.bandwidth < usedData) {
                        await fetch(`https://${storeName}/admin/api/2024-04/recurring_application_charges/${store.chargeId}.json`, {
                            method: 'DELETE',
                            headers: {
                                'X-Shopify-Access-Token': accessToken.access_token
                            }
                        });

                        await db.store.update({
                            where: { name: storeName },
                            data: { plan: 'FREE' }
                        });
                    }
                }

                await fetch(`${process.env.MQSERVER}/image/upload-image`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uid, productid, compressedBuffer, storeName })
                });

            } catch (error) {
                console.error('Error processing message', error);
            }

        }, {
            noAck: true
        });
    });

    // auto_compression
    connection.createChannel(function (error1, channel) {
        if (error1) {
            console.error('Failed to create auto_compression channel', error1);
            process.exit(1);
        }

        const queue = 'auto_compression';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {
            try {
                const data = JSON.parse(msg.content.toString());
                const { uid, productId: productid, url, store_name: storeName } = data;

                const getStoreData = await db.store.findFirst({ where: { name: storeName } });

                if (!getStoreData) {
                    console.error(`Store ${storeName} not found`);
                    return;
                }

                if (getStoreData.autoCompression || getStoreData.batchCompress) {
                    console.log("Compressing URL:", url);

                    const response = await axios.get(url, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(response.data, 'binary');
                    const megabytes = buffer.length / 1024 / 1024;

                    const uint8Array = new Uint8Array(buffer);
                    const header = uint8Array.subarray(0, 4);

                    let qualifyPercenties;

                    if (getStoreData.compressionType === 'BALANCED') {
                        qualifyPercenties = 80;
                    } else if (getStoreData.compressionType === 'CONSERVATIVE') {
                        qualifyPercenties = 65;
                    } else {
                        if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                            qualifyPercenties = getStoreData.png;
                        } else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
                            qualifyPercenties = getStoreData.jpeg;
                        } else {
                            qualifyPercenties = getStoreData.others;
                        }
                    }

                    const compressedBuffer = await sharp(buffer).jpeg({ quality: qualifyPercenties }).toBuffer();

                    if (getStoreData.dataUsed !== null) {
                        const usedData = megabytes + getStoreData.dataUsed;

                        await db.store.update({
                            where: { name: storeName },
                            data: { dataUsed: usedData }
                        });

                        const accessTokenResponse = await fetch(`https://${storeName}/admin/oauth/access_token`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                client_id: process.env.SHOPIFY_CLIENT_ID,
                                client_secret: process.env.SHOPIFY_CLIENT_SECRET,
                                grant_type: 'client_credentials'
                            })
                        });

                        const accessToken = await accessTokenResponse.json();

                        const subscriptionPlan = await db.subscriptionPlan.findFirst({
                            where: { name: getStoreData.plan }
                        });

                        if (subscriptionPlan.bandwidth < usedData) {
                            await fetch(`https://${storeName}/admin/api/2024-04/recurring_application_charges/${getStoreData.chargeId}.json`, {
                                method: 'DELETE',
                                headers: { 'X-Shopify-Access-Token': accessToken.access_token }
                            });

                            await db.store.update({
                                where: { name: storeName },
                                data: { plan: 'FREE' }
                            });
                        }
                    }

                    await fetch(`${process.env.MQSERVER}/image/upload-image`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid, productid, compressedBuffer, storeName })
                    });
                }
            } catch (error) {
                console.error('Error processing message', error);
            }

        }, {
            noAck: true
        });
    });

    // auto_restore
    connection.createChannel(function (error1, channel) {
        if (error1) {
            console.error('Failed to create auto_restore channel', error1);
            process.exit(1);
        }

        const queue = 'auto_restore';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            try {
                const data = JSON.parse(msg.content.toString());
                const { uid, productId: productid, url, store_name } = data;

                const getStoreData = await db.store.findFirst({
                    where: { name: store_name }
                });

                if (!getStoreData) {
                    console.error(`Store ${store_name} not found`);
                    return;
                }

                if (getStoreData.batchRestore) {
                    await fetch(`${process.env.MQSERVER}/image/restore-upload`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid, productid, url, store_name })
                    });
                }
            } catch (error) {
                console.error('Error processing message', error);
            }

        }, {
            noAck: true
        });
    });

    // auto_file_rename
    connection.createChannel(function (error1, channel) {
        if (error1) {
            console.error('Failed to create auto_file_rename channel', error1);
            process.exit(1);
        }

        const queue = 'auto_file_rename';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            try {
                const data = JSON.parse(msg.content.toString());
                const { uid, store_name } = data;

                const image = await db.image.findFirst({ where: { uid } });

                if (!image) {
                    console.error(`Image with UID ${uid} not found`);
                    return;
                }

                const response = await fetch(`${process.env.MQSERVER}/rename/auto-file-rename`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storeName: store_name, uid: `${uid}` })
                });

                if (!response.ok) {
                    console.error(`Failed to rename file: ${response.statusText}`);
                    return;
                }

                const responseData = await response.json();
                console.log(`File renamed successfully: ${responseData}`);
            } catch (error) {
                console.error('Error processing message', error);
            }

        }, {
            noAck: true
        });
    });

    // auto_alt_rename
    connection.createChannel(function (error1, channel) {
        if (error1) {
            console.error('Failed to create auto_alt_rename channel', error1);
            process.exit(1);
        }

        const queue = 'auto_alt_rename';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            try {
                const data = JSON.parse(msg.content.toString());
                const { uid, store_name } = data;

                const image = await db.image.findFirst({ where: { uid } });

                if (!image) {
                    console.error(`Image with UID ${uid} not found`);
                    return;
                }

                const response = await fetch(`${process.env.MQSERVER}/rename/auto-alt-rename`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storeName: store_name, uid: `${uid}` })
                });

                if (!response.ok) {
                    console.error(`Failed to rename alt text: ${response.statusText}`);
                    return;
                }

                const responseData = await response.json();
                console.log(`Alt text renamed successfully: ${responseData}`);
            } catch (error) {
                console.error('Error processing message', error);
            }

        }, {
            noAck: true
        });
    });

    // compressor_to_uploader
    connection.createChannel(function (error1, channel) {
        if (error1) {
            console.error('Failed to create a channel', error1);
            process.exit(1);
        }

        const queue = 'compressor_to_uploader';

        channel.assertQueue(queue, {
            durable: false
        });

        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {
            try {
                const content = JSON.parse(msg.content.toString());
                const { uid, productid, compressedBuffer, storeName } = content;
                const base64Image = Buffer.from(compressedBuffer).toString('base64');

                const singleImageData = await db.image.findFirst({ where: { uid } });
                if (!singleImageData) {
                    console.error(`Image with UID ${uid} not found`);
                    return;
                }

                const singleProductData = await db.product.findFirst({ where: { id: productid } });
                if (!singleProductData) {
                    console.error(`Product with ID ${productid} not found`);
                    return;
                }

                const regex = new RegExp(`-${uid}(C|N)`, 'g');
                const imageName = singleImageData.name.replace(regex, '');

                console.log("Image name:", imageName);

                if (productid !== '1') {
                    const image = {
                        alt: `${imageName.split('.').slice(0, -1).join('.')}-${uid}C.${singleImageData.name.split('.').pop()}`,
                        product_id: productid,
                        attachment: base64Image
                    };

                    const accessTokenResponse = await fetch(`https://${storeName}/admin/oauth/access_token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            client_id: process.env.SHOPIFY_CLIENT_ID,
                            client_secret: process.env.SHOPIFY_CLIENT_SECRET,
                            grant_type: 'client_credentials'
                        })
                    });

                    const accessToken = await accessTokenResponse.json();
                    if (!accessToken.access_token) {
                        console.error('Failed to get access token');
                        return;
                    }

                    const getImageData = await fetch(`https://${storeName}/admin/api/2024-01/products/${productid}/images/${singleImageData.id}.json`, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': accessToken.access_token
                        }
                    });

                    const getImageDataRes = await getImageData.json();
                    const response = await axios.get(getImageDataRes.image.src, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(response.data, 'binary');
                    const base64ImageForBackup = Buffer.from(buffer).toString('base64');

                    const deleteImage = await fetch(`https://${storeName}/admin/api/2024-01/products/${productid}/images/${singleImageData.id}.json`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': accessToken.access_token
                        }
                    });

                    if (deleteImage.status === 200) {
                        const uploadResponse = await fetch(`https://${storeName}/admin/api/2024-01/products/${productid}/images.json`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Shopify-Access-Token': accessToken.access_token
                            },
                            body: JSON.stringify({ image })
                        });

                        const uploadData = await uploadResponse.json();
                        await db.backupimage.create({
                            data: {
                                restoreId: `${uid}`,
                                url: base64ImageForBackup
                            }
                        });
                    } else {
                        console.error('Failed to delete image from Shopify');
                    }
                } else {
                    const getUploadcareImageStatus = await fetch(`https://api.uploadcare.com/files/${singleImageData.id}/storage/`, {
                        headers: {
                            'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                        }
                    });

                    const getUploadcareImageUrl = await fetch(`https://api.uploadcare.com/files/${singleImageData.id}/`, {
                        headers: {
                            'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                        }
                    });

                    const originalFilePath = await getUploadcareImageUrl.json();
                    const response = await axios.get(originalFilePath.original_file_url, { responseType: 'arraybuffer' });

                    const buffer = Buffer.from(response.data, 'binary');
                    const bufferString = Buffer.from(buffer).toString('base64');

                    if (getUploadcareImageStatus.status === 200) {
                        await fetch(`https://api.uploadcare.com/files/${singleImageData.id}/storage/`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                            }
                        });

                        const uploadData = await uploadFile(
                            Buffer.from(compressedBuffer),
                            {
                                publicKey: process.env.UPLOADCARE_PUBLIC_KEY,
                                store: 'auto',
                                fileName: singleImageData.name,
                                metadata: {
                                    subsystem: 'js-client',
                                    pet: `COMPRESSED-${uid}`
                                }
                            }
                        );

                        await db.backupimage.create({
                            data: {
                                restoreId: `${uid}`,
                                url: bufferString
                            }
                        });
                    } else {
                        console.error('Failed to delete image from Uploadcare');
                    }
                }
            } catch (error) {
                console.error('Error processing message', error);
            }
        }, {
            noAck: true
        });
    });

    // periodic_update
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
            const { uid, productid, url } = data;

            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');

            const compressedBuffer = await sharp(buffer).resize(300, 300).jpeg({ quality: 60 }).toBuffer();

            // Update the status in the database
            const updatedImage = await db.image.update({
                where: { uid },
                data: { status: 'COMPRESSED' },
            });

            const uploadImage = await fetch(`${process.env.MQSERVER}/image/upload-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ uid, productid, compressedBuffer })
            })

        }, {
            noAck: true
        });
    });

    // restore_image
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
            const { uid, productid, url, store_name } = data;

            const uploadImage = await fetch(`${process.env.MQSERVER}/image/restore-upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ uid, productid, url, store_name })
            })

        }, {
            noAck: true
        });
    });

    // restore_to_uploader
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

            const { uid, productid, url, store_name: storeName } = content;

            const imageData = await db.image.findFirst({
                where: {
                    uid: parseInt(uid)
                }
            })

            const alt = imageData.name.split('.')[0].split('-')
            alt.pop()

            const altName = alt.join('-')

            const regex = new RegExp(`-${uid}(C|N)`, 'g');
            const imageName = altName.replace(regex, '');

            console.log("image name 2", imageName)
            console.log("store name", storeName)

            if (productid !== '1') {
                const image = {
                    alt: `${imageName}-${uid}N.${imageData.alt.split('.').pop()}`,
                    product_id: productid,
                    attachment: url,
                };

                const accessTokenResponse = await fetch(`https://${storeName}/admin/oauth/access_token`, {
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


                const deleteImage = await fetch(`https://${storeName}/admin/api/2024-01/products/${productid}/images/${imageData.id}.json`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': `${accessToken.access_token}`
                    },
                })

                if (deleteImage.status === 200) {
                    const response = await fetch(`https://${storeName}/admin/api/2024-01/products/${productid}/images.json`, {
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

                const base64Image3 = Buffer.from(url, 'base64');


                // fs.writeFileSync('hello2.jpg', base64Image3)

                const getUploadcareImage = await fetch(`https://api.uploadcare.com/files/${imageData.id}/storage/`, {
                    headers: {
                        'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                    }
                })

                if (getUploadcareImage.status === 200) {
                    const deleteFileReq = await fetch(`https://api.uploadcare.com/files/${imageData.id}/storage/`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                        }
                    })

                    // const restoreImageName = await db.backupfilename.findFirst({
                    //     where: {
                    //         restoreId: `${id}`
                    //     }
                    // })


                    const data = await uploadFile(
                        base64Image3,
                        {
                            publicKey: 'c0bc9dbd97f5de75c062',
                            store: 'auto',
                            fileName: `${imageData.name}`,
                            metadata: {
                                subsystem: 'js-client',
                                pet: `RESTORED-${uid}`
                            }
                        }
                    )


                }

            }

            const existBackupImageFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/${uid}`)

            if (existBackupImageFromCustomDB.status === 200) {
                const removeImageFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/${uid}`, {
                    method: 'DELETE'
                })
            }

            // const existImageFromCustomDB = await fetch(`${process.env.MQSERVER}/image/${imageData.id}`)

            // if (existImageFromCustomDB.status === 200) {
            //     const removeImageFromCustomDB = await fetch(`${process.env.MQSERVER}/image/${imageData.id}`, {
            //         method: 'DELETE'
            //     })
            // }

            // const exitBackupFileNameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/filename/${id}`)

            // if (exitBackupFileNameFromCustomDB.status === 200) {
            //     const removeFilenameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/filename/${id}`, {
            //         method: 'DELETE'
            //     })
            // }

            // const exitBackupAltNameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/altname/${id}`)

            // if (exitBackupAltNameFromCustomDB.status === 200) {
            //     const removeAltnameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/altname/${id}`, {
            //         method: 'DELETE'
            //     })
            // }


        }, {
            noAck: true
        });
    });
});

server.listen(port, () => {
    console.log(`server up and running on port: ${port}`)
})
