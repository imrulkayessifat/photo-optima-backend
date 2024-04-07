import { Request, Response } from "express";

export const compressData = async (req: Request, res: Response): Promise<void> => {

    try {
        const compressData = req.body;

        const { id } = compressData;
        console.log(id)

        res.status(201).json({ data: compressData });
    } catch (e) {
        res.status(500).json({ error: 'An error occurred while compressing image.' });
    }

};