import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

const db = new PrismaClient();

export const getAllImages = async (req: Request, res: Response): Promise<void> => {
    try {
        const images = await db.image.findMany();

        res.status(200).json({ data: images });
    } catch (e) {
        console.log(e);
    }
};

export const getImageById = async (req: Request, res: Response): Promise<void> => {
    try {
        const imageId = req.params.id;
        const image = await db.image.findUnique({
            where: {
                id: imageId,
            },
        });

        res.status(200).json({ data: image });
    } catch (e) {
        console.log(e);
    }
};

export const getImageByProductId = async (req: Request, res: Response): Promise<void> => {
    try {
        const productId = req.params.id;
        console.log(productId)
        const images = await db.image.findMany({
            where: {
                productId: productId,
            },
        });

        res.status(200).json({ data: images });
    } catch (e) {
        console.log(e);
    }
};

export const storeImage = async (req: Request, res: Response): Promise<void> => {
    try {
        const productId = req.params.id;
        const imageData = req.body;
        const { id, url, status } = imageData;
        const image = await db.image.create({
            data: {
                id,
                url,
                status,
                productId
            }
        })
        res.status(201).json({ data: image });
    } catch (e) {
        res.status(500).json({ error: 'An error occurred while storing product data.' });
    }
}

export const deleteImageById = async (req: Request, res: Response): Promise<void> => {
    try {
        const imageId = req.params.id;
        const image = await db.image.delete({
            where: {
                id: imageId,
            },
        });

        res.status(200).json({ data: {} });
    } catch (e) {
        console.log(e);
    }
}
