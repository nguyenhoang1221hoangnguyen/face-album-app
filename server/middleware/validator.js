const Joi = require('joi');

// Schema for login
const loginSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .required()
    .messages({
      'string.empty': 'Username không được để trống',
      'string.min': 'Username phải có ít nhất 3 ký tự',
      'string.max': 'Username không được quá 30 ký tự',
      'any.required': 'Vui lòng nhập username'
    }),
  password: Joi.string()
    .min(6)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Password không được để trống',
      'string.min': 'Password phải có ít nhất 6 ký tự',
      'any.required': 'Vui lòng nhập password'
    })
});

// Schema for creating album
const createAlbumSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Tên album không được để trống',
      'string.max': 'Tên album không được quá 100 ký tự',
      'any.required': 'Vui lòng nhập tên album'
    }),
  description: Joi.string()
    .max(500)
    .allow('')
    .optional()
    .messages({
      'string.max': 'Mô tả không được quá 500 ký tự'
    }),
  drive_link: Joi.string()
    .uri()
    .pattern(/drive\.google\.com/)
    .required()
    .messages({
      'string.uri': 'Link không hợp lệ',
      'string.pattern.base': 'Vui lòng nhập link Google Drive',
      'any.required': 'Vui lòng nhập link Google Drive'
    }),
  is_private: Joi.boolean()
    .optional()
    .default(false),
  password: Joi.string()
    .min(4)
    .max(50)
    .when('is_private', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    })
    .messages({
      'string.min': 'Mật khẩu phải có ít nhất 4 ký tự',
      'string.max': 'Mật khẩu không được quá 50 ký tự',
      'any.required': 'Album riêng tư cần có mật khẩu'
    })
});

// Schema for updating album
const updateAlbumSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Tên album không được để trống',
      'string.max': 'Tên album không được quá 100 ký tự'
    }),
  description: Joi.string()
    .max(500)
    .allow('')
    .optional(),
  is_private: Joi.boolean()
    .optional(),
  password: Joi.string()
    .min(4)
    .max(50)
    .allow('')
    .optional()
});

// Schema for album password verification
const verifyPasswordSchema = Joi.object({
  password: Joi.string()
    .required()
    .messages({
      'string.empty': 'Vui lòng nhập mật khẩu',
      'any.required': 'Vui lòng nhập mật khẩu'
    })
});

// Schema for face search
const searchSchema = Joi.object({
  image: Joi.string()
    .pattern(/^data:image\/(png|jpeg|jpg|gif|webp);base64,/)
    .required()
    .messages({
      'string.pattern.base': 'Ảnh không hợp lệ, vui lòng gửi ảnh base64',
      'any.required': 'Vui lòng gửi ảnh'
    })
});

// Schema for change password
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Vui lòng nhập mật khẩu hiện tại'
    }),
  newPassword: Joi.string()
    .min(6)
    .max(100)
    .required()
    .messages({
      'string.min': 'Mật khẩu mới phải có ít nhất 6 ký tự',
      'any.required': 'Vui lòng nhập mật khẩu mới'
    })
});

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        error: errors[0],
        errors: errors
      });
    }

    req.body = value;
    next();
  };
};

module.exports = {
  validate,
  loginSchema,
  createAlbumSchema,
  updateAlbumSchema,
  verifyPasswordSchema,
  searchSchema,
  changePasswordSchema
};
