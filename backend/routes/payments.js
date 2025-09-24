const express = require('express');
const { body, validationResult } = require('express-validator');
const Payment = require('../models/Payment');
const Tenant = require('../models/Tenant');
const { auth, roleCheck } = require('../middleware/auth');
const Daraja = require('daraja-api');

const router = express.Router();

const daraja = new Daraja({
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
});

// Get payments (admin, property_manager, landlord, tenant)
router.get('/', auth, async (req, res) => {
  try {
    let payments;
    if (req.user.role === 'tenant') {
      const tenant = await Tenant.findOne({ user: req.user._id });
      payments = await Payment.find({ tenant: tenant._id }).populate('tenant');
    } else if (req.user.role === 'landlord') {
      // Get payments for tenants in landlord's properties
      const tenants = await Tenant.find().populate({
        path: 'property',
        match: { landlord: req.user._id }
      });
      const tenantIds = tenants.filter(t => t.property).map(t => t._id);
      payments = await Payment.find({ tenant: { $in: tenantIds } }).populate('tenant');
    } else if (req.user.role === 'property_manager') {
      // Similar for manager
      const tenants = await Tenant.find().populate({
        path: 'property',
        match: { manager: req.user._id }
      });
      const tenantIds = tenants.filter(t => t.property).map(t => t._id);
      payments = await Payment.find({ tenant: { $in: tenantIds } }).populate('tenant');
    } else if (req.user.role === 'admin') {
      payments = await Payment.find().populate('tenant');
    } else {
      return res.status(403).send({ error: 'Access denied.' });
    }
    res.send(payments);
  } catch (e) {
    res.status(500).send(e);
  }
});

// Initiate M-Pesa payment (tenant)
router.post('/mpesa', auth, roleCheck('tenant'), [
  body('amount').isNumeric(),
  body('phone').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, phone } = req.body;
    const tenant = await Tenant.findOne({ user: req.user._id });

    // Create payment record
    const payment = new Payment({
      tenant: tenant._id,
      amount,
      method: 'mpesa',
    });
    await payment.save();

    // Initiate STK push
    const stkResponse = await daraja.stkPush({
      amount,
      phone,
      accountReference: `Rent-${tenant._id}`,
      transactionDesc: 'Rent Payment',
    });

    // Update payment with transaction id
    payment.transactionId = stkResponse.CheckoutRequestID;
    await payment.save();

    res.send({ payment, stkResponse });
  } catch (e) {
    res.status(400).send(e);
  }
});

// M-Pesa callback
router.post('/mpesa/callback', async (req, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    const checkoutRequestId = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    const payment = await Payment.findOne({ transactionId: checkoutRequestId });
    if (payment) {
      if (resultCode === 0) {
        payment.status = 'completed';
      } else {
        payment.status = 'failed';
      }
      await payment.save();
    }

    res.send({ message: 'Callback received' });
  } catch (e) {
    res.status(500).send(e);
  }
});

// Manual payment entry (admin, property_manager)
router.post('/', auth, roleCheck('admin', 'property_manager'), [
  body('tenant').isMongoId(),
  body('amount').isNumeric(),
  body('method').isIn(['cash', 'bank']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const payment = new Payment(req.body);
    payment.status = 'completed'; // Manual payments are completed
    await payment.save();
    res.status(201).send(payment);
  } catch (e) {
    res.status(400).send(e);
  }
});

module.exports = router;