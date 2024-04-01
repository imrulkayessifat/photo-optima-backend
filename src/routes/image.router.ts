import { Router } from "express";
import {
    getAllImages,
    getImageById,
    storeImage,
    deleteImageById
} from "../controllers/image.controller";

const imageRouter = Router();

imageRouter.get("/", getAllImages);
imageRouter.get("/:id", getImageById);
imageRouter.post("/:id", storeImage);
imageRouter.delete("/:id",deleteImageById)


export default imageRouter;