const express = require('express');
const ctrl = require('../controllers/media.controller');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.post('/upload', authenticate, upload.single('file'), ctrl.upload);

module.exports = router;
