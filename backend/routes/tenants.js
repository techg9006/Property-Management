const express = require('express');
const { body, validationResult } = require('express-validator');
const Tenant = require('../models/Tenant');
const Property = require('../models/Property');
const { auth, roleCheck } = require('../middleware/auth');

const router = express.Router();

// Get all tenants (admin, property_manager, landlord)
router.get('/', auth, async (req, res) => {
  try {
    let tenants;
    if (req.user.role === 'landlord') {
      const properties = await Property.find({ landlord: req.user._id });
      const propertyIds = properties.map(p => p._id);
      tenants = await Tenant.find({ property: { $in: propertyIds } }).populate('user property');
    } else if (req.user.role === 'property_manager') {
      const properties = await Property.find({ manager: req.user._id });
      const propertyIds = properties.map(p => p._id);
      tenants = await Tenant.find({ property: { $in: propertyIds } }).populate('user property');
    } else if (req.user.role === 'tenant') {
      tenants = await Tenant.find({ user: req.user._id }).populate('user property');
    } else if (req.user.role === 'admin') {
      tenants = await Tenant.find().populate('user property');
    } else {
      return res.status(403).send({ error: 'Access denied.' });
    }
    res.send(tenants);
  } catch (e) {
    res.status(500).send(e);
  }
});

// Create tenant (admin, property_manager)
router.post('/', auth, roleCheck('admin', 'property_manager'), [
  body('user').isMongoId(),
  body('property').isMongoId(),
  body('leaseStart').isISO8601(),
  body('leaseEnd').isISO8601(),
  body('rentAmount').isNumeric(),
  body('deposit').isNumeric(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const tenant = new Tenant(req.body);
    await tenant.save();
    // Add to property tenants
    await Property.findByIdAndUpdate(req.body.property, { $push: { tenants: tenant._id } });
    res.status(201).send(tenant);
  } catch (e) {
    res.status(400).send(e);
  }
});

// Get tenant by id
router.get('/:id', auth, async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).populate('user property');
    if (!tenant) {
      return res.status(404).send();
    }
    // Check access
    if (req.user.role === 'tenant' && tenant.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    if (req.user.role === 'landlord') {
      const property = await Property.findById(tenant.property);
      if (property.landlord.toString() !== req.user._id.toString()) {
        return res.status(403).send({ error: 'Access denied.' });
      }
    }
    if (req.user.role === 'property_manager') {
      const property = await Property.findById(tenant.property);
      if (property.manager.toString() !== req.user._id.toString()) {
        return res.status(403).send({ error: 'Access denied.' });
      }
    }
    res.send(tenant);
  } catch (e) {
    res.status(500).send(e);
  }
});

// Update tenant (admin, property_manager)
router.put('/:id', auth, roleCheck('admin', 'property_manager'), async (req, res) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!tenant) {
      return res.status(404).send();
    }
    res.send(tenant);
  } catch (e) {
    res.status(400).send(e);
  }
});

// Delete tenant (admin)
router.delete('/:id', auth, roleCheck('admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findByIdAndDelete(req.params.id);
    if (!tenant) {
      return res.status(404).send();
    }
    // Remove from property
    await Property.findByIdAndUpdate(tenant.property, { $pull: { tenants: tenant._id } });
    res.send(tenant);
  } catch (e) {
    res.status(500).send(e);
  }
});

module.exports = router;