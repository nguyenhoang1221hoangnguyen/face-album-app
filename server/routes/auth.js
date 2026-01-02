const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate, loginSchema, changePasswordSchema } = require('../middleware/validator');

const router = express.Router();

router.post('/login', authLimiter, validate(loginSchema), (req, res) => {
  const { username, password } = req.body;

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  
  if (!admin) {
    return res.status(401).json({ error: 'Tài khoản không tồn tại' });
  }

  const validPassword = bcrypt.compareSync(password, admin.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Mật khẩu không đúng' });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, username: admin.username });
});

router.post('/change-password', require('../middleware/auth'), validate(changePasswordSchema), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  
  if (!bcrypt.compareSync(currentPassword, admin.password)) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(hashedPassword, req.admin.id);
  
  res.json({ message: 'Đổi mật khẩu thành công' });
});

module.exports = router;
