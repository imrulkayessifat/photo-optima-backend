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

export const getImageStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const imageId = req.params.id;
        
        const image = await db.image.findUnique({ where: { id: imageId } });
        
        res.status(200).json({ status: image!.status });
    } catch (error) {
        res.status(500).json({ error: 'An error occurred while fetching image status.' });
    }
}
