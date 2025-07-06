const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_KEY)
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const serviceAccount = require("./firebase-adminsdk-fbsvc-9900303e74.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// console.log(process.env.DB_PASS)
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ylneatr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db('Drop_Swift_parcel&Delivery')
    const parcelCollection = db.collection('parcels')
    const paymentCollection = db.collection('payments')
    const userCollection = db.collection('users')
    const ridersCollection = db.collection('riders')
    const riderPaymentCollection = db.collection('riderPayments')
    const trackingsCollection = db.collection("trackings");
    const verifyFirebaseToken = async (req, res, next) => {
      console.log('Headers in Middleware', req.headers)
      const authHeader = req.headers.authorization
      if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' })
      }
      const token = authHeader.split(' ')[1]
      if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
      }
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);

        req.decoded = decodedToken
      } catch (error) {
        console.error(error);
        return res.status(401).send({ message: 'forbidden access' });
      }

      next()
    }
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email
      console.log(req.decoded)
      const query = { email }
      const user = await userCollection.findOne(query)
      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }
    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email
      console.log(req.decoded)
      const query = { email }
      const user = await userCollection.findOne(query)
      if (!user || user.role !== 'rider') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExists = await userCollection.findOne({ email })
      if (userExists) {
        return res.status(200).send({ message: 'User Already Exists', inserted: false })
      }
      const user = req.body;
      const result = await userCollection.insertOne(user)
      res.send(result)
    })
    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ message: 'Email query parameter is required' });
      }

      try {
        const user = await userCollection.findOne(
          { email }
        );

        if (user) {
          res.send({ role: user.role || 'user' });
        } else {
          res.status(404).send({ message: 'User not found' });
        }
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error while fetching user' });
      }
    });

    app.get('/users/search', verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: 'Missing email query' })
      }
      const query = {
        email: {
          $regex: email,
          $options: 'i' // case-insensitive
        }
      };
      app.patch('/users/:id/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        if (!['admin', 'user'].includes(role)) {
          return res.status(400).send({ message: "Invalid Role" })
        }
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { role }
        };

        const result = await userCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          res.send({ message: 'User role updated successfully' });
        } else {
          res.status(404).send({ message: 'User not found or role unchanged' });
        }
      });

      const users = await userCollection.find(query).project({ email: 1, createdAt: 1, role: 1 }).limit(10).toArray();

      if (users.length > 0) {
        res.send(users);
      } else {
        res.status(404).send({ message: 'No users found' });
      }
    });

    app.post('/parcels', async (req, res) => {
      try {
        const newItem = req.body;
        const result = await parcelCollection.insertOne(newItem);
        res.send(result)
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    // Example route
    app.get('/parcels', verifyFirebaseToken, async (req, res) => {
      try {
        const { email, delivery_status } = req.query;

        // Check if token owner matches the email in query
        if (email && req.decoded.email !== email) {
          return res.status(403).send({ message: 'forbidden access' });
        }

        const filter = {};

        // If email is provided, filter by createdBy
        if (email) {
          filter.createdBy = email;
        }

        // If delivery_status is provided, filter parcels by status
        if (delivery_status) {
          filter.delivery_status = delivery_status;
        }

        const items = await parcelCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(items);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
      }
    });

    app.get('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    app.delete('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };

        const result = await parcelCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: 'Parcel not found' });
        }

        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).json({
          success: false,
          message: 'Something went wrong',
          error: error.message
        });
      }
    });
    app.get('/rider/parcels', verifyFirebaseToken, verifyRider, async (req, res) => {
      console.log('🎯 API hit: /parcels/rider');
      try {
        const riderEmail = req.query.email;
        console.log('Rider email:', riderEmail);

        if (!riderEmail) {
          return res.status(400).json({
            message: 'Missing rider email in query parameter.'
          });
        }
        const parcels = await parcelCollection
          .find({
            assignedRiderEmail: riderEmail,
            delivery_status: { $in: ['rider-assigned', 'in_transit'] }
          })
          .toArray();

        res.send(parcels);
      } catch (error) {
        console.error('Error fetching parcels for rider:', error);
        res.status(500).json({
          message: 'Failed to fetch parcels for rider.',
          error: error.message
        });
      }
    });
    app.get('/rider/earnings', async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).json({ message: 'Missing rider email.' });
        }

        // Find parcels assigned to this rider with pending payment
        const pendingParcels = await parcelCollection
          .find({
            assignedRiderEmail: email,
            delivery_status: 'delivered',
            rider_payment_status: 'pending'
          })
          .toArray();

        // Find all past rider payments
        const riderPayments = await riderPaymentCollection
          .find({
            riderEmail: email
          })
          .toArray();

        res.send({
          pendingParcels,
          riderPayments
        });

      } catch (error) {
        console.error(error);
        res.status(500).json({
          message: 'Failed to fetch earnings data.',
          error: error.message
        });
      }
    });

    app.post('/create-payment-intent', async (req, res) => {

      const amountInCent = req.body.amountInCent

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCent, // Amount in cents
          currency: 'usd',
          payment_method_types: ['card'],

        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    app.post("/tracking", async (req, res) => {
      const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    });
    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, email, amount, paymentMethod, transactionId } = req.body
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set:
              { payment_status: "paid" }
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).json({ message: "Parcel not found." });
        }
        const paymentDoc = {
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paidAt: new Date().toISOString()
        };
        const paymentResult = await paymentCollection.insertOne(paymentDoc)
        res.send(paymentResult)
      } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to update parcel status." });
      }
    });
    app.post('/rider/cashout', verifyFirebaseToken, verifyRider, async (req, res) => {
      try {
        const { email, amount, parcelIds } = req.body;

        if (!email || !amount || !parcelIds?.length) {
          return res.status(400).json({
            message: 'Missing required data for cashout.'
          });
        }

        // Save cashout record
        await riderPaymentCollection.insertOne({
          riderEmail: email,
          amount,
          parcelIds,
          payoutDate: new Date()
        });

        // Optionally mark parcels as paid to avoid recounting earnings
        await parcelCollection.updateMany(
          { _id: { $in: parcelIds.map(id => new ObjectId(id)) } },
          { $set: { rider_payment_status: 'paid' } }
        );

        res.send({ success: true, message: 'Cashout successful!' });
      } catch (error) {
        console.error('Cashout error:', error);
        res.status(500).json({
          message: 'Cashout failed.',
          error: error.message
        });
      }
    });

    app.post('/riders', async (req, res) => {
      const rider = req.body
      const result = await ridersCollection.insertOne(rider)
      res.send(result)
    })
    app.get('/riders/pending', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const query = { status: 'pending' };
        const pendingRider = await ridersCollection.find(query).toArray();

        if (pendingRider) {
          res.send(pendingRider);
        } else {
          res.status(404).send({ message: 'No pending rider found.' });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });
    app.get('/riders/active', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const query = { status: 'approved' };
      const result = await ridersCollection.find(query).toArray();
      res.send(result);
    });
    app.get('/parcel/delivered', verifyFirebaseToken, verifyRider, async (req, res) => {
      try {
        const riderEmail = req.query.email;
        console.log(riderEmail)
        if (!riderEmail) {
          return res.status(400).json({
            message: 'Missing rider email in query parameter.'
          });
        }
        const options = { sort: { createdAt: -1 } }
        const deliveredParcels = await parcelCollection.find({
          assignedRiderEmail: riderEmail,
          delivery_status: { $in: ['delivered', 'service_center-delivered'] }
        }, options)
          .toArray();

        res.send(deliveredParcels);
      } catch (error) {
        console.error('Error fetching delivered parcels:', error);
        res.status(500).json({
          message: 'Failed to fetch delivered parcels.',
          error: error.message
        });
      }
    });
    app.patch('/parcels/:id/status', async (req, res) => {
      try {
        const parcelId = req.params.id;
        const { status, assignedRiderId, assignedRiderName, assignedRiderEmail } = req.body;

        if (!status) {
          return res.status(400).send({ message: 'Status is required' });
        }

        const filter = { _id: new ObjectId(parcelId) };
        const updateDoc = {
          $set: {
            delivery_status: status,
            assignedRiderId: assignedRiderId,
            assignedRiderName: assignedRiderName,
            assignedRiderEmail: assignedRiderEmail
          }
        };
        await ridersCollection.updateOne(
          { _id: new ObjectId(assignedRiderId) },
          {
            $set: {
              work_status: "in_delivery",
            },
          }
        );

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          res.send({ message: 'Parcel status updated successfully' });
        } else {
          res.status(404).send({ message: 'Parcel not found or status unchanged' });
        }
      } catch (error) {
        console.error('Error updating parcel status:', error);
        res.status(500).send({ message: 'Server error while updating parcel status' });
      }
    });
    app.patch(
      '/parcels/:id/condition',
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
          return res
            .status(400)
            .json({ message: 'Missing delivery status.' });
        }

        try {
          const filter = { _id: new ObjectId(id) };

          const setFields = {
            delivery_status: status,
            rider_payment_status: 'pending'
          };

          if (status === 'in_transit') {
            setFields.picked_at = new Date().toISOString();
          }

          if (status === 'delivered') {
            setFields.deliveredAt = new Date().toISOString();
          }

          const update = {
            $set: setFields
          };

          const result = await parcelCollection.updateOne(
            filter,
            update
          );

          if (result.modifiedCount === 0) {
            return res
              .status(404)
              .json({ message: 'Parcel not found or not updated.' });
          }

          res.json({
            message: 'Parcel status updated successfully.'
          });
        } catch (error) {
          console.error('Error updating parcel status:', error);
          res
            .status(500)
            .json({
              message: 'Internal server error.',
              error: error.message
            });
        }
      }
    );

    app.post("/tracking", async (req, res) => {
      const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    });
    app.get("/trackings/:trackingId", async (req, res) => {
      const trackingId = req.params.trackingId;

      const updates = await trackingsCollection
        .find({ tracking_id: trackingId })
        .sort({ timestamp: 1 }) // sort by time ascending
        .toArray();

      res.json(updates);
    });

    app.post("/trackings", async (req, res) => {
      const update = req.body;

      update.timestamp = new Date(); // ensure correct timestamp
      if (!update.tracking_id || !update.status) {
        return res.status(400).json({ message: "tracking_id and status are required." });
      }

      const result = await trackingsCollection.insertOne(update);
      res.status(201).json(result);
    });
    app.patch('/riders/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { status, email } = req.body;

        if (!status) {
          return res.status(400).send({ message: 'Status field is required.' });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status }
        };
        if (status === 'approved') {
          const useQuery = { email };
          const userUpdateDoc = {
            $set: {
              role: 'rider'
            }
          }
          const roleResult = await userCollection.updateOne(useQuery, userUpdateDoc)

        }
        const result = await ridersCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          res.send({ message: 'Rider status updated successfully.' });
        } else {
          res.status(404).send({ message: 'Rider not found or status unchanged.' });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error while updating rider status.' });
      }
    });
    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      // console.log('Headers',req.headers)
      try {
        const { email, parcelId } = req.query;
        console.log('decoded', req.decoded)
        if (req.decoded.email !== email) {
          return res.status(403).send({ message: 'forbidden access' });
        }
        // Build a query object based on optional filters
        const query = {};
        if (email) query.email = email;
        if (parcelId) query.parcelId = parcelId;
        const options = { sort: { paidAt: -1 } }
        const payments = await paymentCollection.find(query, options).toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({ message: "Failed to fetch payments." });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Drop-swift is running')
})
app.listen(PORT, () => {
  console.log(`Server in Listening to ${PORT}`)
})