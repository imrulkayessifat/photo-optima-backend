import { Request, Response } from "express";

export const subscribeData = async (req: Request, res: Response): Promise<void> => {
    console.log(req.body)
    res.status(201).json({ data: req.body });
}