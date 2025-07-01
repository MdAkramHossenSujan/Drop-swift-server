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
        const email = req.query.email;
        console.log('decoded', req.decoded)
        if (req.decoded.email !== email) {
          return res.status(403).send({ message: 'forbidden access' });
        }
        const filter = email ? { createdBy: email } : {};

        const items = await parcelCollection.find(filter).sort({ createdAt: -1 }).toArray(); // latest first

        res.status(200).json(items);
      } catch (err) {
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