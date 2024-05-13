import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const getRawBody = require('raw-body')

const db = new PrismaClient();

export const fileUpload = async (req: Request, res: Response): Promise<void> => {
    const body = await getRawBody(req);
    const imageData = JSON.parse(body.toString())
    console.log(imageData)
    await db.image.create({
        data: {
            id: imageData.data.uuid,
            name: imageData.data.original_filename,
            alt: imageData.data.original_filename,
            url: imageData.file,
            productId: '1',
        }
    })
    res.status(201).json({ data: 'image created!' });
}