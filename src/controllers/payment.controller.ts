import { Request, Response } from "express";

export const makePayment = async (req: Request, res: Response): Promise<void> => {
    try {

        const paymentData = req.body;
        console.log("payment data : ",paymentData)

        res.redirect('http://localhost:3000/settings')
    } catch (e) {
        res.status(500).json({ error: 'An error occurred while storing product data.' });
    }
}