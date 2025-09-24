const express = require('express');
const { body, validationResult } = require('express-validator');
const Property = require('../models/Property');
const { auth, roleCheck } = require('../middleware/auth');

const router = express.Router();

// Get all properties (admin, property_manager, landlord)
router.get('/', auth, async (req, res) => {
  try {
    let properties;
    if (req.user.role === 'landlord') {
      properties = await Property.find({ landlord: req.user._id }).populate('landlord manager tenants');
    } else if (req.user.role === 'property_manager') {
      properties = await Property.find({ manager: req.user._id }).populate('landlord manager tenants');
    } else if (req.user.role === 'admin') {
      properties = await Property.find().populate('landlord manager tenants');
    } else {
      return res.status(403).send({ error: 'Access denied.' });
    }
    res.send(properties);
  } catch (e) {
    res.status(500).send(e);
  }
});

// Create property (admin, property_manager)
router.post('/', auth, roleCheck('admin', 'property_manager'), [
  body('name').notEmpty(),
  body('address').notEmpty(),
  body('rentAmount').isNumeric(),
  body('landlord').isMongoId(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const property = new Property(req.body);
    await property.save();
    res.status(201).send(property);
  } catch (e) {
    res.status(400).send(e);
  }
});

// Get property by id
router.get('/:id', auth, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id).populate('landlord manager tenants');
    if (!property) {
      return res.status(404).send();
    }
    // Check access
    if (req.user.role === 'landlord' && property.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    if (req.user.role === 'property_manager' && property.manager.toString() !== req.user._id.toString()) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    res.send(property);
  } catch (e) {
    res.status(500).send(e);
  }
});

// Update property (admin, property_manager)
router.put('/:id', auth, roleCheck('admin', 'property_manager'), async (req, res) => {
  try {
    const property = await Property.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!property) {
      return res.status(404).send();
    }
    res.send(property);
  } catch (e) {
    res.status(400).send(e);
  }
});

// Delete property (admin)
router.delete('/:id', auth, roleCheck('admin'), async (req, res) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id);
    if (!property) {
      return res.status(404).send();
    }
    res.send(property);
  } catch (e) {
    res.status(500).send(e);
  }
});

module.exports = router;