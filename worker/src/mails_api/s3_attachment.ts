import { Context } from "hono";

// aws-sdk 体积巨大（min 后数百 KB），95% 不用 S3 的用户也不该为它买单。
// 改为按需动态 import：只有真正调用 S3 接口时才加载，wrangler 会做代码分割，
// 主包体积和 Worker 冷启动都不再受影响。
type S3Deps = {
    S3Client: typeof import("@aws-sdk/client-s3").S3Client;
    ListObjectsV2Command: typeof import("@aws-sdk/client-s3").ListObjectsV2Command;
    GetObjectCommand: typeof import("@aws-sdk/client-s3").GetObjectCommand;
    PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand;
    DeleteObjectCommand: typeof import("@aws-sdk/client-s3").DeleteObjectCommand;
    getSignedUrl: typeof import("@aws-sdk/s3-request-presigner").getSignedUrl;
};

let s3DepsCache: S3Deps | null = null;
async function getS3Deps(): Promise<S3Deps> {
    if (!s3DepsCache) {
        const [s3, presigner] = await Promise.all([
            import("@aws-sdk/client-s3"),
            import("@aws-sdk/s3-request-presigner"),
        ]);
        s3DepsCache = {
            S3Client: s3.S3Client,
            ListObjectsV2Command: s3.ListObjectsV2Command,
            GetObjectCommand: s3.GetObjectCommand,
            PutObjectCommand: s3.PutObjectCommand,
            DeleteObjectCommand: s3.DeleteObjectCommand,
            getSignedUrl: presigner.getSignedUrl,
        };
    }
    return s3DepsCache;
}

export const isS3Enabled = (c: Context<HonoCustomType>) => {
    return !(!c.env.S3_ENDPOINT ||
        !c.env.S3_ACCESS_KEY_ID ||
        !c.env.S3_SECRET_ACCESS_KEY ||
        !c.env.S3_BUCKET);
}

const getS3Client = async (c: Context<HonoCustomType>) => {
    if (
        !c.env.S3_ENDPOINT ||
        !c.env.S3_ACCESS_KEY_ID ||
        !c.env.S3_SECRET_ACCESS_KEY ||
        !c.env.S3_BUCKET
    ) {
        throw new Error("S3 config is not set");
    }
    const { S3Client } = await getS3Deps();
    return new S3Client({
        region: "auto",
        endpoint: c.env.S3_ENDPOINT,
        credentials: {
            accessKeyId: c.env.S3_ACCESS_KEY_ID,
            secretAccessKey: c.env.S3_SECRET_ACCESS_KEY,
        },
    });
}

export default {
    getSignedGetUrl: async (c: Context<HonoCustomType>) => {
        const { address } = c.get("jwtPayload")
        const { key } = await c.req.json()
        const { getSignedUrl, GetObjectCommand } = await getS3Deps();
        const client = await getS3Client(c);
        const url = await getSignedUrl(
            client,
            new GetObjectCommand({
                Bucket: c.env.S3_BUCKET,
                Key: `${address}/${key}`
            }),
            { expiresIn: c.env.S3_URL_EXPIRES || 360 }
        );
        return c.json({ url });
    },
    getSignedPutUrl: async (c: Context<HonoCustomType>) => {
        const { address } = c.get("jwtPayload")
        const { key } = await c.req.json()
        const { getSignedUrl, PutObjectCommand } = await getS3Deps();
        const client = await getS3Client(c);
        const url = await getSignedUrl(
            client,
            new PutObjectCommand({
                Bucket: c.env.S3_BUCKET,
                Key: `${address}/${key}`
            }),
            { expiresIn: c.env.S3_URL_EXPIRES || 360 }
        );
        return c.json({ url });
    },
    list: async (c: Context<HonoCustomType>) => {
        const { address } = c.get("jwtPayload")
        const { ListObjectsV2Command } = await getS3Deps();
        const client = await getS3Client(c);
        const data = await client.send(
            new ListObjectsV2Command({
                Bucket: c.env.S3_BUCKET,
                Prefix: `${address}/`
            })
        );
        return c.json(
            {
                results: data?.Contents
                    ?.map((v) => v.Key?.replace(`${address}/`, ""))
                    ?.filter(k => k)
                    ?.map((k) => ({ key: k }))
            }
        );
    },
    deleteKey: async (c: Context<HonoCustomType>) => {
        const { address } = c.get("jwtPayload")
        const { key } = await c.req.json()
        const { DeleteObjectCommand } = await getS3Deps();
        const client = await getS3Client(c);
        await client.send(
            new DeleteObjectCommand({
                Bucket: c.env.S3_BUCKET,
                Key: `${address}/${key}`
            })
        );
        return c.json({ success: true });
    }
}
