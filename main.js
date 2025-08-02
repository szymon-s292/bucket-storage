require('dotenv').config();
const APIKeyAuth = require("./auth.js")
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');

const sanitizeId = id => id.replace(/[^a-zA-Z0-9_-]/g, '');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const id = req.params.id
    const uploadPath = path.join(UPLOAD_DIR, sanitizeId(id));
    
    if(!fs.existsSync(uploadPath))
      fs.mkdirSync(uploadPath, { recursive: true });
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Math.random().toString(16).substr(2, 12)}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage: storage });
const UPLOAD_DIR = process.env.ROOT_DIR
const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME

const client = new MongoClient(MONGO_URL)

const express = require('express');
const app = express()
app.use(express.json())

const bucketExists = async (id) => {
  const db = client.db(DB_NAME);
  const collections = await db.listCollections({ name: id }).toArray();
  return (collections.length == 0) ? false : true
}

const checkPermissions = (permission) => {
  return async (req, res, next) => {
    const bucketId = req.params.id;
    const key = req.apiKey;
    const bucketAccess = key.buckets.find(bucket => bucket.name === bucketId);

    if(!(await bucketExists(bucketId)))
      return res.status(404).json({message: `Bucket ${bucketId} does not exist`})

    if (!bucketAccess || !bucketAccess['all'] && !bucketAccess[permission] )
      return res.status(403).json({ message: `Access denied: cannot ${permission} in this bucket` });

    next();
  };
}





//get file from bucket
app.get('/storage/:id/:filename', async (req, res) => {
  const bucketid = req.params.id

  if(!(await bucketExists(bucketid)))
    return res.status(404).json({message: `Bucket ${bucketid} does not exist`})

  const filename = req.params.filename
  const targetFile = UPLOAD_DIR + `${bucketid}/` + filename

  if(!fs.existsSync(targetFile))
    return res.status(404).json({message: "Requested file does not exist"})

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.status(200).sendFile(targetFile)
})

//upload file/files to bucket
app.post('/storage/:id/upload', APIKeyAuth, checkPermissions('create'), upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ message: "No files were sent" });

  try {
    const id = req.params.id;
    const db = client.db(DB_NAME);
    const collection = db.collection(id)

    const docs = req.files.map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      uploadedAt: new Date(),
      public: true
    }))

    await collection.insertMany(docs)

    res.status(200).json({
      message: `Uploaded ${req.files.length} files to bucket`,
      files: req.files.map(file => ({
        uri: `/storage/${id}/` + file.filename,
        original: file.originalname,
        size: file.size,
        public: true
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

//update file in bucket
app.put('/storage/:id/:filename', APIKeyAuth, checkPermissions('update'), upload.array('files'), async (req, res) => {
  const id = req.params.id;
  const filename = req.params.filename;
  const targetFile = path.join(UPLOAD_DIR, id, filename);

  if (!req.files || req.files.length === 0)
    return res.status(400).json({ message: "No files were sent" });

  if (!fs.existsSync(targetFile))
    return res.status(404).json({ message: "File does not exist" });

  try {
    const db = client.db(DB_NAME);
    const collection = db.collection(id);

    const newFile = Array.from(req.files).at(-1)

    await collection.updateOne(
      { filename: filename },
      { $set: { updatedAt: new Date(), size: newFile.size, filename: req.files[0].filename } }
    );

    const filePath = path.join(UPLOAD_DIR, id, filename);
    if (fs.existsSync(filePath)) fs.unlink(filePath, err => err && console.error(err));

    res.json({
      message: `Updated ${filename}`,
      uri: `/storage/${id}/` + req.files[0].filename,
      original: newFile.originalname,
      size: newFile.size
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

//delete file/files from bucket
app.delete('/storage/:id', APIKeyAuth, checkPermissions('delete'), upload.none(), async (req, res) => {
  const bucketid = req.params.id;
  const filenames = req.body?.filenames;

  if (!Array.isArray(filenames) || filenames.length === 0)
    return res.status(400).json({ message: "No filenames provided" });

  try {
    const db = client.db(DB_NAME);
    const collection = db.collection(bucketid);
    
    for(const filename of filenames) {
      const filePath = path.join(UPLOAD_DIR, bucketid, filename);
      if (fs.existsSync(filePath))
        fs.unlink(filePath, err => err && console.error(err));
      else 
        return res.status(400).json({ message: `File not found: ${filename}` });
    }

    await collection.deleteMany({ filename: { $in: filenames } });

    return res.status(200).json({
      message: `Deleted ${filenames.length} files from bucket ${bucketid}`,
      deleted: filenames
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});





//get stats of bucket
app.get('/bucket/:id', APIKeyAuth, checkPermissions('view'), (req, res) => {
  const bucketid = req.params.id;
  const bucketPath = UPLOAD_DIR + bucketid;

  fs.readdir(bucketPath, (err, files) => {
    if (err) {
      return res.status(500).json({ message: "Error reading files" });
    }

    let fileCount = 0;
    let totalSize = 0;
    const filesAvalible = []

    files.forEach(file => {
      const filePath = path.join(bucketPath, file);
      const stats = fs.statSync(filePath);
      filesAvalible.push({filename: file, size: stats.size})
      if (stats.isFile()) {
        fileCount++;
        totalSize += stats.size;
      }
    });

    res.json({
      bucketid: bucketid,
      fileCount: fileCount,
      filesAvalible: filesAvalible,
      totalSize: totalSize,
    });
  });
});

//create bucket -- only from local backends or auth request in web ui server
app.post('/bucket/:id', async (req, res) => {
  const id = req.params.id

  const db = client.db(DB_NAME);
  const collections = await db.listCollections({ name: id }).toArray();
  if(collections.length > 0)
    return res.status(400).json({message: 'bucket already exists'})

  const collection = db.createCollection(id)
  
  res.status(200).json({message: 'Bucket created'})
});

//rename bucket -- UPDATE NAME IN KEYS
app.put('/bucket/:id', APIKeyAuth, checkPermissions('rename'), async (req, res) => {
  const oldId = req.params.id;
  
  if (!req.body?.newId) return res.status(400).json({ message: 'newId is required' });
  const newId = req.body.newId;

  const db = client.db(DB_NAME);

  if (!bucketExists(newId)) {
    return res.status(400).json({ message: 'New bucket name already exists' });
  }

  try {
    await db.renameCollection(oldId, newId);

    const oldPath = path.join(UPLOAD_DIR, oldId);
    const newPath = path.join(UPLOAD_DIR, newId);
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
    }

    res.json({ message: `Bucket renamed from ${oldId} to ${newId}`, bucketId: newId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error renaming bucket', error: err });
  }
});

//delete bucket
app.delete('/bucket/:id', APIKeyAuth, checkPermissions('drop'), async (req, res) => {
  const bucketid = req.params.id;
  const db = client.db(DB_NAME);

  try {
    if (!bucketExists(bucketid)) {
      return res.status(404).json({ message: 'Bucket does not exist' });
    }

    await db.collection(bucketid).drop();

    const dirPath = path.join(UPLOAD_DIR, bucketid);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }

    res.json({ message: `Bucket '${bucketid}' deleted` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting bucket', error: err });
  }
});



//create key, change permission, add/remove buckets access from key, revoke key

// app.post('/apikey/')

async function startServer() {
  try {
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    console.log('Connected to MongoDB');

    app.listen(4000, () => {
      console.log(`Bucket API started.`)
    });

  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
}

startServer();