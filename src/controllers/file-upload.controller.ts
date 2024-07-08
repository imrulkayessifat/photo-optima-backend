import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
    deleteFile,
    UploadcareSimpleAuthSchema,
} from '@uploadcare/rest-client';
import { io } from "../index";

const getRawBody = require('raw-body')

const db = new PrismaClient();

const uploadcareSimpleAuthSchema = new UploadcareSimpleAuthSchema({
    publicKey: `${process.env.UPLOADCARE_PUBLIC_KEY}`,
    secretKey: `${process.env.UPLOADCARE_SECRET_KEY}`,
});

export const fileUpload = async (req: Request, res: Response): Promise<void> => {
    try {

        const body = await getRawBody(req);
        const imageData = JSON.parse(body.toString())

        const state = imageData.data.metadata.pet.split('-')[0]

        if (state === 'RESTORED') {
            await db.image.update({
                where: {
                    uid: parseInt(imageData.data.metadata.pet.split('-')[1])
                },
                data: {
                    id: imageData.data.uuid,
                    name: imageData.data.original_filename,
                    // alt: imageData.data.original_filename,
                    url: imageData.file,
                    productId: '1',
                    status: 'NOT_COMPRESSED'
                }
            })
        }
        else if (state === 'COMPRESSED') {
            const uid = imageData.data.metadata.pet.split('-')[1]

            await db.image.update({
                where: {
                    uid: parseInt(uid)
                },
                data: {
                    id: imageData.data.uuid,
                    name: imageData.data.original_filename,
                    // alt: imageData.data.original_filename,
                    url: imageData.file,
                    productId: '1',
                    status: 'COMPRESSED'
                }
            })
        }
        else {
            await db.image.create({
                data: {
                    id: imageData.data.uuid,
                    name: imageData.data.original_filename,
                    alt: imageData.data.original_filename,
                    url: imageData.file,
                    productId: '1',
                    status: 'NOT_COMPRESSED',
                    storename:`${state}`
                }
            })
        }

        io.emit('image_model', () => {
            console.log('an event occured in manual upload');
        });
        res.status(201).json({ data: 'image created!' });
    } catch (e) {
        res.status(400).json({ error: 'something went wrong!' })
    }
}

export const fileDelete = async (req: Request, res: Response): Promise<void> => {
    try {
        const uuid = req.params.id;

        const result = await deleteFile(
            {
                uuid: `${uuid}`,
            },
            { authSchema: uploadcareSimpleAuthSchema }
        )

        res.status(200).json({ data: result });
    } catch (error) {
        res.status(404).json({ error: 'An error occurred while fetching image status.' });
    }

}