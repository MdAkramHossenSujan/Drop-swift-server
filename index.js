const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
const stripe=require('stripe')(process.env.PAYMENT_KEY)
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
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
    app.get('/parcels', async (req, res) => {
      try {
        const email = req.query.email;
        console.log(email)
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
          payment_method_types:['card'],
          // payment_method: paymentMethodId,
          // confirmation_method: 'manual',
          // confirm: true,
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
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