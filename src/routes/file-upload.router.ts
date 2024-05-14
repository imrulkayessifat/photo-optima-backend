import { Router } from "express";

import {
    fileUpload,
    fileDelete
} from "../controllers/file-upload.controller";

const fileUploadRouter = Router()

fileUploadRouter.post('/upload', fileUpload)
fileUploadRouter.delete('/upload/:id', fileDelete)

export default fileUploadRouter;