const archiver = require('archiver');
const AWS = require('aws-sdk');
const { PassThrough } = require('stream');

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const SECRET_KEY = process.env.SECRET_KEY;

exports.handler = async (event) => {
  // 1. Auth check
  const auth = event.headers?.Authorization || event.headers?.authorization;
  if (auth !== `Bearer ${SECRET_KEY}`) {
    return respond(401, { error: 'Unauthorized' });
  }

  // 2. Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { app_name, user_id, files } = body;
  if (!app_name || !user_id || !files || !files.length) {
    return respond(400, { error: 'Missing required fields: app_name, user_id, files' });
  }

  // 3. Build ZIP in memory
  try {
    const zipBuffer = await buildZip(files);

    // 4. Upload to S3
    const key = `generated-apps/${user_id}/${app_name}-${Date.now()}.zip`;
    await s3.putObject({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: zipBuffer,
      ContentType: 'application/zip',
    }).promise();

    // 5. Generate presigned URL (valid for 24 hours)
    const zip_url = s3.getSignedUrl('getObject', {
      Bucket: BUCKET_NAME,
      Key: key,
      Expires: 86400,
    });

    return respond(200, { success: true, zip_url });
  } catch (err) {
    console.error(err);
    return respond(500, { error: 'Failed to generate ZIP', detail: err.message });
  }
};

function buildZip(files) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const passThrough = new PassThrough();
    const archive = archiver('zip', { zlib: { level: 9 } });

    passThrough.on('data', (chunk) => chunks.push(chunk));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);
    archive.on('error', reject);

    archive.pipe(passThrough);

    files.forEach(({ filename, content }) => {
      archive.append(content, { name: filename });
    });

    archive.finalize();
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}