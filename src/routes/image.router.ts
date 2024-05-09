import { Router } from "express";
import {
    getAllImages,
    getImageStatus,
} from "../controllers/image.controller";

const imageRouter = Router();

imageRouter.get("/", getAllImages);
imageRouter.get("/image-status/:id", getImageStatus);


export default imageRouter;