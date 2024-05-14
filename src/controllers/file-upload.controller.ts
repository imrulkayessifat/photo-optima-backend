import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
    deleteFile,
    UploadcareSimpleAuthSchema,
} from '@uploadcare/rest-client';


const getRawBody = require('raw-body')

const db = new PrismaClient();

const uploadcareSimpleAuthSchema = new UploadcareSimpleAuthSchema({
    publicKey: `${process.env.UPLOADCARE_PUBLIC_KEY}`,
    secretKey: `${process.env.UPLOADCARE_SECRET_KEY}`,
});

export const fileUpload = async (req: Request, res: Response): Promise<void> => {
    const body = await getRawBody(req);
    const imageData = JSON.parse(body.toString())
    const status = imageData.data.metadata.pet === 'NOTCOMPRESSED' ? 'NOT_COMPRESSED' : 'COMPRESSED'
    console.log(imageData)
    await db.image.create({
        data: {
            id: imageData.data.uuid,
            name: imageData.data.original_filename,
            alt: imageData.data.original_filename,
            url: imageData.file,
            productId: '1',
            status: status
        }
    })
    res.status(201).json({ data: 'image created!' });
}

export const fileDelete = async (req: Request, res: Response): Promise<void> => {
    const uuid = req.params.id;

    console.log("uuid", uuid)
    const result = await deleteFile(
        {
            uuid: `${uuid}`,
        },
        { authSchema: uploadcareSimpleAuthSchema }
    )

    res.status(200).json({ data: result });
}