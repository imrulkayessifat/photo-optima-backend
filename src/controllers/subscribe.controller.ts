import { Request, Response } from "express";

export const subscribeData = async (req: Request, res: Response): Promise<void> => {
    
    res.status(201).json({ data: req.body });
}