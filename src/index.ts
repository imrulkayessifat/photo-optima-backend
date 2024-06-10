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
const fs = require('fs');


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

app.get("/", (req, res) => {
    res.json({ message: "response from backend" }).status(200);
});


amqp.connect('amqp://localhost?frameMax=10485760', function (error0: any, connection: { createChannel: (arg0: (error1: any, channel: any) => void) => void; }) {
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
            console.log('store name',storeName)

            const store = await db.store.findFirst({
                where: {
                    name: storeName
                }
            })


            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');

            const megabytes = (buffer.length / 1024) / 1024;

            let qualifyPercenties;

            const uint8Array = new Uint8Array(buffer);
            const header = uint8Array.subarray(0, 4);

            if (store.compressionType === 'BALANCED') {
                qualifyPercenties = 80
            } else if (store.compressionType === 'CONSERVATIVE') {
                qualifyPercenties = 65;
            } else {
                if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                    qualifyPercenties = store.png;
                } else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
                    qualifyPercenties = store.jpeg;
                } else {
                    qualifyPercenties = store.others
                }
            }

            const compressedBuffer = await sharp(buffer).jpeg({ quality: qualifyPercenties }).toBuffer();

            // fs.writeFileSync('hello.jpg', compressedBuffer);

            const subscriptionPlan = {
                "FREE": 25,
                "MICRO": 500,
                "PRO": 2048,
                "ADVANCED": 5120,
                "PREMIUM": 15360,
                "PLUS": 51200,
                "ENTERPRISE": 102400
            }

            // Update the status in the database
            // const updatedImage = await db.image.update({
            //     where: { id: id },
            //     data: { status: 'COMPRESSED' },
            // });


            if (store.dataUsed !== null) {
                const usedData = megabytes + store.dataUsed
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


            const uploadImage = await fetch(`${process.env.MQSERVER}/image/upload-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, productid, compressedBuffer,storeName })
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

            if (getStoreData.autoCompression || getStoreData.batchCompress) {
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data, 'binary');

                const megabytes = (buffer.length / 1024) / 1024;

                const uint8Array = new Uint8Array(buffer);
                const header = uint8Array.subarray(0, 4);

                let qualifyPercenties;

                if (getStoreData.compressionType === 'BALANCED') {
                    qualifyPercenties = 80
                } else if (getStoreData.compressionType === 'CONSERVATIVE') {
                    qualifyPercenties = 65;
                } else {
                    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                        qualifyPercenties = getStoreData.png;
                    } else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
                        qualifyPercenties = getStoreData.jpeg;
                    } else {
                        qualifyPercenties = getStoreData.others
                    }
                }

                const compressedBuffer = await sharp(buffer).jpeg({ quality: qualifyPercenties }).toBuffer();

                // fs.writeFileSync('hello.jpg', compressedBuffer);

                const subscriptionPlan = {
                    "FREE": 25,
                    "MICRO": 500,
                    "PRO": 2048,
                    "ADVANCED": 5120,
                    "PREMIUM": 15360,
                    "PLUS": 51200,
                    "ENTERPRISE": 102400
                }

                // Update the status in the database
                // const updatedImage = await db.image.update({
                //     where: { id: id },
                //     data: { status: 'COMPRESSED' },
                // });

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

                const uploadImage = await fetch(`${process.env.MQSERVER}/image/upload-image`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id, productid, compressedBuffer, storeName })
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

        const queue = 'auto_restore';

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

            if (getStoreData.batchRestore) {
                const uploadImage = await fetch(`${process.env.MQSERVER}/image/restore-upload`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id, productid, url, storeName })
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

        const queue = 'auto_file_rename';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const data = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, store_name } = data;

            const image = await db.image.findFirst({
                where: {
                    id: id
                }
            })

            if (image) {
                const req = await fetch(`${process.env.MQSERVER}/rename/file-rename`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        storeName: store_name,
                        id: `${id}`,
                    })
                })

                const data = await req.json()
            }

        }, {
            noAck: true
        });
    });

    connection.createChannel(function (error1, channel) {
        if (error1) {
            throw error1;
        }

        const queue = 'auto_alt_rename';

        channel.assertQueue(queue, {
            durable: false
        });


        channel.consume(queue, async function (msg: { content: { toString: () => any; }; }) {

            const data = JSON.parse(msg.content.toString());

            // Access id and url from the data
            const { id, store_name } = data;

            const image = await db.image.findFirst({
                where: {
                    id: id
                }
            })

            if (image) {
                const req = await fetch(`${process.env.MQSERVER}/rename/alt-rename`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        storeName: store_name,
                        id: `${id}`,
                    })
                })

                const data = await req.json()
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
            const { id, productid, compressedBuffer, storeName } = content;
            console.log(id)
            const base64Image = Buffer.from(compressedBuffer).toString('base64');

            const singleImageData = await db.image.findFirst({
                where: {
                    id: id
                }
            })

            console.log(singleImageData)

            const singleProductData = await db.product.findFirst({
                where: {
                    id: productid
                }
            })

            if (productid !== '1') {
                const image = {
                    alt: `${singleImageData.name.split('.').slice(0, -1).join('.')}-${id}C.${singleImageData.name.split('.').pop()}`,
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

                    await db.backupimage.create({
                        data: {
                            restoreId: `${data.image.id}`,
                            url: base64ImageForBackup
                        }
                    })

                    await db.backupfilename.create({
                        data: {
                            restoreId: `${data.image.id}`,
                            name: `${singleImageData.name}`
                        }
                    })

                    await db.backupaltname.create({
                        data: {
                            restoreId: `${data.image.id}`,
                            alt: `${singleImageData.name}`
                        }
                    })

                }


            } else {
                const base64Image2 = Buffer.from(compressedBuffer);

                const getUploadcareImageStatus = await fetch(`https://api.uploadcare.com/files/${id}/storage/`, {
                    headers: {
                        'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                    }
                })

                const getUploadcareImageUrl = await fetch(`https://api.uploadcare.com/files/${id}/`, {
                    headers: {
                        'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
                    }
                })

                const originalFilePath = await getUploadcareImageUrl.json();

                console.log(originalFilePath)

                const response = await axios.get(originalFilePath.original_file_url, { responseType: 'arraybuffer' });

                const buffer = Buffer.from(response.data, 'binary');
                const bufferString = Buffer.from(buffer).toString('base64');
                // fs.writeFileSync('hello1.jpg', buffer)

                if (getUploadcareImageStatus.status === 200) {
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
                            fileName: `${singleImageData.name}`,
                            metadata: {
                                subsystem: 'js-client',
                                pet: `COMPRESSED_${id}`
                            }
                        }
                    )
                    await db.backupimage.create({
                        data: {
                            restoreId: `${data.uuid}`,
                            url: bufferString
                        }
                    })

                    await db.backupfilename.create({
                        data: {
                            restoreId: `${data.uuid}`,
                            name: `${singleImageData.name}`
                        }
                    })

                    await db.backupaltname.create({
                        data: {
                            restoreId: `${data.uuid}`,
                            alt: `${singleImageData.name}`
                        }
                    })
                }

            }

            const existImageFromCustomDB = await fetch(`${process.env.MQSERVER}/image/${id}`)

            if (existImageFromCustomDB.status === 200) {
                console.log("603",existImageFromCustomDB)
                const updatedImage = await db.image.update({
                    where: { id: id },
                    data: { status: 'COMPRESSED' },
                });
                const removeImageFromCustomDB = await fetch(`${process.env.MQSERVER}/image/${id}`, {
                    method: 'DELETE'
                })
            }

            // await db.store.update({
            //     where: {
            //         name: storeName
            //     },
            //     data: {
            //         batchCompress: false
            //     }
            // })


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

            const uploadImage = await fetch(`${process.env.MQSERVER}/image/upload-image`, {
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
            const { id, productid, url, store_name } = data;

            const uploadImage = await fetch(`${process.env.MQSERVER}/image/restore-upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, productid, url, store_name })
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
            const { id, productid, url, storeName } = content;
            console.log("store name : ",storeName)

            const restoreFileName = await db.backupaltname.findFirst({
                where: {
                    restoreId: `${id}`
                }
            })

            console.log(restoreFileName.alt)

            if (productid !== '1') {
                const image = {
                    alt: `${restoreFileName.alt}`,
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

                console.log(deleteImage.status)

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

                    

                    await db.backupfilename.delete({
                        where: {
                            restoreId: `${id}`
                        }
                    })

                    await db.backupaltname.delete({
                        where: {
                            restoreId: `${id}`
                        }
                    })

                }


            } else {

                const base64Image3 = Buffer.from(url, 'base64');


                // fs.writeFileSync('hello2.jpg', base64Image3)

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

                    const restoreImageName = await db.backupfilename.findFirst({
                        where: {
                            restoreId: `${id}`
                        }
                    })


                    const data = await uploadFile(
                        base64Image3,
                        {
                            publicKey: 'c0bc9dbd97f5de75c062',
                            store: 'auto',
                            fileName: `${restoreImageName.name}`,
                            metadata: {
                                subsystem: 'js-client',
                                pet: `NOTCOMPRESSED`
                            }
                        }
                    )


                }

            }

            const existBackupImageFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/${id}`)

            if (existBackupImageFromCustomDB.status === 200) {
                const removeImageFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/${id}`, {
                    method: 'DELETE'
                })
            }

            const existImageFromCustomDB = await fetch(`${process.env.MQSERVER}/image/${id}`)

            if (existImageFromCustomDB.status === 200) {
                const removeImageFromCustomDB = await fetch(`${process.env.MQSERVER}/image/${id}`, {
                    method: 'DELETE'
                })
            }

            const exitBackupFileNameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/filename/${id}`)

            if (exitBackupFileNameFromCustomDB.status === 200) {
                const removeFilenameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/filename/${id}`, {
                    method: 'DELETE'
                })
            }

            const exitBackupAltNameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/altname/${id}`)

            if (exitBackupAltNameFromCustomDB.status === 200) {
                const removeAltnameFromCustomDB = await fetch(`${process.env.MQSERVER}/backup/altname/${id}`, {
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
