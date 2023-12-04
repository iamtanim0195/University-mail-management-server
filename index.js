const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const port = process.env.PORT || 8000;
const uri = process.env.DB_URI;
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    const usersCollection = client.db('pro-12').collection('users');
    const mealsCategoryCollection = client.db('pro-12').collection('mealsByCategory');
    const upComingMealsCollection = client.db('pro-12').collection('upComingMeals');
    const bookingCollection = client.db('pro-12').collection('booking');
    const reqInfoCollection = client.db('pro-12').collection('reqInfo');
    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      console.log('I need a new jwt', user)
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Save or modify user email, status in DB
    app.put('/users/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body
      const query = { email: email }
      const options = { upsert: true }
      const isExist = await usersCollection.findOne(query)
      console.log('User found?----->', isExist)
      if (isExist) return res.send(isExist)
      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      )
      res.send(result)
    })
    //get role
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })
    //get all Meals by category
    app.get('/mealsCategory', async (req, res) => {
      const result = await mealsCategoryCollection.find().toArray()
      res.send(result)
    })
    //get all up coming Meals by category
    app.get('/upComingMeals', async (req, res) => {
      const result = await upComingMealsCollection.find().toArray()
      res.send(result)
    })

    // get meals for user

    //get single Meal by id
    app.get('/mealsCategory/meal/:id', async (req, res) => {
      const id = req.params.id
      const result = await mealsCategoryCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })
    // save meals in db
    app.post('/mealsCategory', verifyToken, async (req, res) => {
      const meal = req.body
      const result = await mealsCategoryCollection.insertOne(meal)
      res.send(result)
    });
    // save upComingMeals in db
    app.post('/upComingMeals', verifyToken, async (req, res) => {
      const meal = req.body
      const result = await upComingMealsCollection.insertOne(meal)
      res.send(result)
    });
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      if (!price || amount < 1) return
      const { client_secret } = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      })
      res.send({ clientSecret: client_secret });
    });
    //save req info
    app.post('/reqInfo', verifyToken, async (req, res) => {
      const reqInfo = req.body
      const result = await reqInfoCollection.insertOne(reqInfo)
      res.send(result)
    })
    app.get('/reqInfo', async (req, res) => {
      const result = await reqInfoCollection.find().toArray()
      res.send(result)
    })
    // save booking info
    app.post('/bookings', verifyToken, async (req, res) => {
      const booking = req.body
      const result = await bookingCollection.insertOne(booking)
      res.send(result)
    })
    app.get('/bookings', async (req, res) => {
      const result = await bookingCollection.find().toArray()
      res.send(result)
    })
    //update likes
    app.patch('/mealsCategory/review/:id', verifyToken, async (req, res) => {
      const mealId = req.params.id;
      const { review, likes, UserEmail } = req.body;
      try {
        // Update the likes and add the review
        const result = await mealsCategoryCollection.updateOne(
          { _id: new ObjectId(mealId) },
          {
            $set: { likes: likes },
            $addToSet: {
              reviews: { UserEmail: UserEmail, review: review, date: new Date() },
            },
          }
        );
        // Send the updated result back to the client
        res.send(result);
      } catch (error) {
        // Handle errors
        console.error(error);
        res.status(500).send('Internal Server Error');
      }
    });
    // users
    app.get('/users', verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result);
    })
    //update user role
    app.put('/users/update/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query ={email: email}
      const options = {upsert: true}
      const updateDoc = {
        $set:{
          ...user,timestamp: Date.now(),
        }
      }
      const result = await usersCollection.updateOne(query,updateDoc, options)
      res.send(result)
    })

    //update booking satuses
    app.patch('/mealsCategory/status/:id', async (req, res) => {
      const id = req.params.id
      const status = req.body.status
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          booked: status,
        }
      }
      const result = await mealsCategoryCollection.updateOne(query, updateDoc)
      res.send(result)
    })
    // Send a ping to confirm a successful connection
    /* await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment.You successfully connected to MongoDB!'
    ) */
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from icu Server..')
})

app.listen(port, () => {
  console.log(`icu is running on port ${port}`)
})
