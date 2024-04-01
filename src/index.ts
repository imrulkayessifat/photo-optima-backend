import express from 'express';

import productRouter from './routes/product.router';
import imageRouter from './routes/image.router';

const app = express();
const port = process.env.PORT || 8080;

app.use(express.json())

app.use("/products", productRouter);
app.use("/images", imageRouter);

app.get("/",(req,res)=>{
    res.json({message:"demo response"}).status(200)
})


app.listen(port,()=>{
    console.log(`server up and running on port: ${port}`)
})