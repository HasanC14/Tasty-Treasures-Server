const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const multer = require("multer");
const path = require("path");
require("dotenv").config();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage: storage });

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@back-prac-2-admin.sldkkq5.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    const UsersCollection = client.db("TastyTreasures").collection("Users");
    const RecipesCollection = client.db("TastyTreasures").collection("Recipes");

    // Register User (with default 50 coins)
    app.put("/registerUser", async (req, res) => {
      try {
        const user = req.body;
        user.coins = 50;

        const existingUser = await UsersCollection.findOne({
          email: user.email,
        });

        if (!existingUser) {
          const result = await UsersCollection.insertOne(user);
          res.send(result);
        }
      } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).send({ error: "Failed to register user" });
      }
    });

    // Get User Data by Email
    app.get("/user", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        const user = await UsersCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).send({ error: "Failed to fetch user data" });
      }
    });

    // Add Recipe
    app.post("/addRecipe", upload.array("images", 10), async (req, res) => {
      try {
        if (req.files && req.files.length > 0) {
          console.log("Files uploaded successfully:", req.files);
          const {
            title,
            description,
            ingredients,
            steps,
            category,
            videoURL,
            country,
            creatorEmail,
          } = req.body;
          const userQuery = { email: creatorEmail };
          const user = await UsersCollection.findOne(userQuery);
          user.coins += 50;
          await UsersCollection.updateOne(userQuery, {
            $set: { coins: user.coins },
          });

          const imageUrls = req.files.map(
            (file) => `/uploads/${file.filename}`
          );

          const formattedRecipe = {
            title,
            description,
            ingredients: ingredients.split(",").map((item) => item.trim()),
            steps: steps.split("\n").map((item) => item.trim()),
            category,
            country,
            videoURL,
            imageUrls,
            creatorEmail,
            watchCount: 0,
            purchased_by: [],
            reactions: [],
          };

          const result = await RecipesCollection.insertOne(formattedRecipe);
          res.status(200).json(result);
        } else {
          console.log("No files uploaded");
          res.status(400).json({ error: "No files uploaded" });
        }
      } catch (error) {
        console.error("Error uploading files:", error);
        res.status(500).json({ error: "Error uploading files" });
      }
    });

    // View Recipe Details
    app.get("/recipe/:id", async (req, res) => {
      const id = req.params.id;
      const userEmail = req.query.userEmail;
      const query = { _id: new ObjectId(id) };
      const recipe = await RecipesCollection.findOne(query);

      if (!recipe) {
        return res.status(404).send({ message: "Recipe not found" });
      }

      const userQuery = { email: userEmail };
      const user = await UsersCollection.findOne(userQuery);

      if (!user) {
        return res.status(401).send({ message: "User not logged in" });
      }

      if (user.email === recipe.creatorEmail) {
        return res.send({ redirect: "recipeDetails", recipe });
      }

      if (user.coins < 10) {
        return res.send({
          redirect: "purchaseCoins",
          message: "Not enough coins",
        });
      }

      if (recipe.purchased_by.includes(userEmail)) {
        return res.send({ redirect: "recipeDetails", recipe });
      }

      user.coins -= 10;
      await UsersCollection.updateOne(userQuery, {
        $set: { coins: user.coins },
      });
      await UsersCollection.updateOne(
        { email: recipe.creatorEmail },
        { $inc: { coins: 5 } }
      );
      recipe.purchased_by.push(userEmail);
      recipe.watchCount += 1;
      await RecipesCollection.updateOne(query, { $set: recipe });

      res.send({ redirect: "recipeDetails", recipe });
    });

    // Purchase Coins
    app.post("/purchaseCoins", async (req, res) => {
      const { email, amount } = req.body;
      const query = { email: email };
      const user = await UsersCollection.findOne(query);

      if (user) {
        const updatedCoins = user.coins + amount;
        await UsersCollection.updateOne(query, {
          $set: { coins: updatedCoins },
        });
        res.send({ message: "Coins purchased successfully", updatedCoins });
      } else {
        res.status(404).send({ message: "User not found" });
      }
    });

    // Reaction System
    app.patch("/recipe/react/:id", async (req, res) => {
      const id = req.params.id;
      const { email } = req.body;
      const query = { _id: new ObjectId(id) };
      const recipe = await RecipesCollection.findOne(query);

      if (!recipe) {
        return res.status(404).send({ message: "Recipe not found" });
      }

      const userReactionIndex = recipe.reactions.indexOf(email);
      if (userReactionIndex > -1) {
        recipe.reactions.splice(userReactionIndex, 1);
      } else {
        recipe.reactions.push(email);
      }

      await RecipesCollection.updateOne(query, {
        $set: { reactions: recipe.reactions },
      });
      res.send(recipe);
    });

    // Recipes
    app.get("/recipes", async (req, res) => {
      const { category, country, page, pageSize = 3 } = req.query;
      const search = req.query.search || "";

      const query = {};

      if (category) {
        query.category = category;
      }

      if (country) {
        query.country = country;
      }

      if (search && search != "") {
        query.title = { $regex: search, $options: "i" };
      }

      let recipes;

      if (page && pageSize) {
        const skip = (page - 1) * pageSize;
        recipes = await RecipesCollection.find(query)
          .skip(skip)
          .limit(parseInt(pageSize))
          .toArray();
      } else {
        recipes = await RecipesCollection.find(query).toArray();
      }

      res.send(recipes);
    });
  } finally {
  }
}
run().catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.send("API running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
