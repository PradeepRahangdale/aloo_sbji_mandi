import cors from 'cors';
import express from 'express';

const app = express();

// Enable CORS for all origins (Flutter web app)
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => res.json({ msg: 'Api is Running' }));

// routes

import adminRouter from './routes/admin.routes.js';
import advertisementRouter from './routes/advertisement.routes.js';
import alooMitraRouter from './routes/alooMitra.routes.js';
import analyticsRouter from './routes/analytics.routes.js';
import boliAlertRouter from './routes/boliAlert.routes.js';
import { router as bookingRouter } from './routes/booking.routes.js';
import counterRouter from './routes/counter.routes.js';
import { router as chatRouter } from './routes/chat.routes.js';
import { router as coldStorageRouter } from './routes/coldStorage.routes.js';
import { router as dealRouter } from './routes/deal.routes.js';
import geocodeRouter from './routes/geocode.routes.js';
import kycRouter from './routes/kyc.routes.js';
import listingRouter from './routes/listing.routes.js';
import managerRouter from './routes/manager.routes.js';
import { router as notificationRouter } from './routes/notification.routes.js';
import { router as paymentRouter } from './routes/payment.routes.js';
import postRouter from './routes/post.routes.js';
import { router as receiptRouter } from './routes/receipt.routes.js';
import subscriptionRouter from './routes/subscription.routes.js';
import tokenRouter from './routes/token.routes.js';
import { router as traderRequestRouter } from './routes/traderRequest.routes.js';
import transactionRouter from './routes/transaction.route.js';
import { router as userRouter } from './routes/user.routes.js';

app.use('/api/v1/user', userRouter);
app.use('/api/v1/cold-storage', coldStorageRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/bookings', bookingRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/posts', postRouter);
app.use('/api/v1/listings', listingRouter);
app.use('/api/v1/trader-requests', traderRequestRouter);
app.use('/api/v1/deals', dealRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/receipts', receiptRouter);
app.use('/api/v1/advertisements', advertisementRouter);
app.use('/api/v1/boli-alerts', boliAlertRouter);
app.use('/api/v1/tokens', tokenRouter);
app.use('/api/v1/counters', counterRouter);
app.use('/api/v1/transactions', transactionRouter);
app.use('/api/v1/subscriptions', subscriptionRouter);
app.use('/api/v1/aloo-mitra', alooMitraRouter);
app.use('/api/v1/kyc', kycRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/manager', managerRouter);
app.use('/api/v1/geocode', geocodeRouter);

// Global error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    errors: err.errors || [],
  });
});

export { app };
