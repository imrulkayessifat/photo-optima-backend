import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

const db = new PrismaClient();

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const products = await db.product.findMany();
        res.status(200).json({ data: products })
    } catch (e) {
        console.log(e);
    }
}

export const getProductById = async (req: Request, res: Response): Promise<void> => {
    try {
        const productId = req.params.id;
        const product = await db.product.findUnique({
            where: {
                id: productId,
            },
        });

        res.status(200).json({ data: product });
    } catch (e) {
        console.log(e);
    }
};


export const storeProductData = async (req: Request, res: Response): Promise<void> => {
    try {
        const productData = req.body;

        const { id, title } = productData;

        const product = await db.product.create({
            data: {
                id,
                title
            }
        })

        res.status(201).json({ data: product });
    } catch (e) {
        res.status(500).json({ error: 'An error occurred while storing product data.' });
    }
};

export const deleteProductById = async (req: Request, res: Response): Promise<void> => {
    try {
        const productId = req.params.id;
        const product = await db.product.delete({
            where: {
                id: productId,
            },
        });

        res.status(200).json({ data: {} });
    } catch (e) {
        console.log(e);
    }
}

