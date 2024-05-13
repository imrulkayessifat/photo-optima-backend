import { Router } from "express";

import {
    fileUpload
} from "../controllers/file-upload.controller";

const fileUploadRouter = Router()

fileUploadRouter.post('/upload', fileUpload)

export default fileUploadRouter;