// SERVER-SIDE 

const axios = require('axios'); // Library required for LTA API documentation 
const ejs = require('ejs');
const express = require('express');
//const serverless = require('serverless-http');
// const mainRoutes = require('./routes/main');
const sqlite3 = require('sqlite3').verbose();
const path = require('path'); // Import the 'path' module
const cron = require('node-cron');
const fs = require('fs');
const csvParser = require('csv-parser');
const { rejects } = require('assert');
const app = express();
const router = express.Router();
const port = 3000;

const db = new sqlite3.Database('database.db');


const API_URL = 'https://api.data.gov.sg/v1/transport/carpark-availability';
const API_URL_ERP = 'http://datamall2.mytransport.sg/ltaodataservice/ERPRates';
const API_KEY = 'pLVbWkqRRpKBmEwLHF//6w==';

app.set("views", path.join(__dirname, "views")); // Use 'path.join' for cross-platform compatibility
app.set("view engine", "ejs");


app.use(express.static(__dirname + '/public'));
app.use(express.static(__dirname + 'css'));
app.use(express.static(__dirname + 'script'));



//Insert intial data
(async()=>{
  try{
    //CSV to table
    fs.createReadStream('./data/HDBCarparkInformation.csv')
    .pipe(csvParser())
    .on('data', async (row)=>{
      const {car_park_no, address, x_coord, y_coord, car_park_type, type_of_parking_system, short_term_parking, free_parking, night_parking, 
        car_park_decks, gantry_height, car_park_basement } = row;
      await db.run('INSERT INTO carparkinfo (car_park_no, address, x_coord, y_coord, car_park_type, type_of_parking_system, short_term_parking,free_parking, night_parking, car_park_decks, gantry_height, car_park_basement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [car_park_no, address, x_coord, y_coord, car_park_type, type_of_parking_system, short_term_parking, free_parking, night_parking, car_park_decks, gantry_height, car_park_basement]);
    })
    .on('end', ()=>{
      console.log('CSV file processing completed.');
    });

    //Insert Intial data
    const response = await axios.get(API_URL);
    const apiData = response.data.items[0].carpark_data;
    
    apiData.forEach(async (carpark)=> {
      const { carpark_number, carpark_info, update_datetime} = carpark;
      const { total_lots, lots_available, lot_type} = carpark_info[0];

      await db.run('INSERT INTO carparks (carparkNumber, totalLots, lotsAvailable, lotType, updateDatetime) VALUES (?,?,?,?,?)',
      [carpark_number, total_lots, lots_available, lot_type, update_datetime]);

    });
    
    console.log('Intial data inserted successfully');

  }catch(error){
    console.error('Error inserting intial data',error);
  }
})();

//Update data in database every 5 mins
cron.schedule('*/5 * * * *', async()=>{
  try{
    const response = await axios.get(API_URL);
    const apiData = response.data.items[0].carpark_data;

    apiData.forEach(async (carpark)=>{
      const { carpark_number, carpark_info, update_datetime} = carpark;
      const { total_lots, lots_available} = carpark_info[0];

      await db.run('UPDATE carparks SET totalLots = ?, lotsAvailable =?, updateDatetime =? WHERE carparkNumber = ?',
      [total_lots, lots_available, update_datetime, carpark_number]);  
    });
    console.log('Data updated successfully');
  } catch(error) {
    console.error('Error updating data', error);
  }
});

app.get('/fetch-data', async (req, res) => {
  try {
    const response = await axios.get(
      'http://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2',
      {
        headers: {
          AccountKey: 'JrUNPOZST02d6av2pOPOMA==',
        },
      }
    );

    const parkingData = response.data.value;

    // Store data in the 'newcarparkinfo' table
    const insertStmt = db.prepare(`
      INSERT INTO newcarparkinfo (CarParkID, Area, Development, Location, AvailableLots, LotType, Agency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.serialize(() => {
      parkingData.forEach((parking) => {
        const {
          CarParkID,
          Area,
          Development,
          Location,
          AvailableLots,
          LotType,
          Agency,
        } = parking;
        insertStmt.run(
          CarParkID,
          Area,
          Development,
          Location,
          AvailableLots,
          LotType,
          Agency
        );
      });
    });

    insertStmt.finalize(); // Finalize the prepared statement

    // Send the fetched data as JSON
    res.json(parkingData);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching and storing data.');
  }
});


app.get('/', (req,res)=>{
  res.render('index.ejs');
})

// app.get('/signup', (req,res)=>{
//   res.render('signup.ejs');
// })

// Define a route to render the loggedin.ejs page
app.get('/loggedinhome', (req, res) => {
  res.render('loggedinhome.ejs'); // Replace 'loggedin' with your actual template name
});
// app.get('/home', (req, res) => {
//     db.all('SELECT * FROM carparks', (err, rows) => {
//         if (err) {
//             console.error(err);
//             return res.sendStatus(500);
//         }
//         res.render('home', { carparks: rows }); // Pass the 'carparks' data to the template
//     });
// });
app.get('/locations', async(req,res)=>{
  try{
   let carparkInfoData = await new Promise((resolve, reject)=>{
    db.all('SELECT car_park_no, address, car_park_type, short_term_parking, free_parking, night_parking, type_of_parking_system FROM carparkinfo', (err, rows)=>{
      if(err){
        reject(err);
      } else{
        resolve(rows);
      }
    });
   });

   let carparksData = await new Promise((resolve, reject)=>{
    db.all('SELECT carparkNumber, totalLots, lotsAvailable FROM carparks', (err, rows)=>{
      if(err){
        reject(err);
      } else{
        resolve(rows);
      }
    });
   });

   // Sort the carparksData array by carparkNumber
   carparksData = carparksData.slice().sort((a, b) => a.carparkNumber.localeCompare(b.carparkNumber));
   
   
   res.render('locations', {carparkInfoData, carparksData});
  //  res.render('map');
  } catch(error){
    console.error('Error fetching data:', error);
    res.status(500).send('An error occurred while fetching data.');
  }
});



app.get('/loggedinlocationsnew', async(req,res)=>{
  try{
   let carparkInfoData = await new Promise((resolve, reject)=>{
    db.all('SELECT car_park_no, address, car_park_type, short_term_parking, free_parking, night_parking, type_of_parking_system FROM carparkinfo', (err, rows)=>{
      if(err){
        reject(err);
      } else{
        resolve(rows);
      }
    });
   });

   let carparksData = await new Promise((resolve, reject)=>{
    db.all('SELECT carparkNumber, totalLots, lotsAvailable FROM carparks', (err, rows)=>{
      if(err){
        reject(err);
      } else{
        resolve(rows);
      }
    });
   });

   // Sort the carparksData array by carparkNumber
   carparksData = carparksData.slice().sort((a, b) => a.carparkNumber.localeCompare(b.carparkNumber));
   
   
   res.render('loggedinlocationsnew', {carparkInfoData, carparksData});
  //  res.render('map');
  } catch(error){
    console.error('Error fetching data:', error);
    res.status(500).send('An error occurred while fetching data.');
  }
});


// //Logged in Locations 
// app.get('/loggedinlocations', async(req,res)=>{
//   try{
//    let carparkInfoData = await new Promise((resolve, reject)=>{
//     db.all('SELECT car_park_no, address, car_park_type, short_term_parking, free_parking, night_parking, type_of_parking_system FROM carparkinfo', (err, rows)=>{
//       if(err){
//         console.error("Error fetchig carparkinfo data:", err);
//         reject(err);
//       } else{
//         console.log("carparkInfoData:", rows);
//         resolve(rows);
//       }
//     });
//    });

//    let carparksData = await new Promise((resolve, reject)=>{
//     db.all('SELECT carparkNumber, totalLots, lotsAvailable FROM carparks', (err, rows)=>{
//       if(err){
//         reject(err);
//       } else{
//         resolve(rows);
//       }
//     });
//    });

//    let newcarparkinfoData = await new Promise((resolve, reject)=>{
//     db.all('SELECT Area FROM newcarparkinfo', (err, rows)=>{
//       if(err){
//         reject(err);
//       } else{
//         resolve(rows);
//       }
//     });
//    });

//    // Sort the carparksData array by carparkNumber
//    carparksData = carparksData.slice().sort((a, b) => a.carparkNumber.localeCompare(b.carparkNumber));
   
   
//    res.render('loggedinlocations', {carparkInfoData, carparksData, newcarparkinfoData});
//   //  res.render('map');
//   } catch(error){
//     console.error('Error fetching data:', error);
//     res.status(500).send('An error occurred while fetching data.');
//   }
// });
   


app.get('/home', (req, res) => {
  res.render('index.ejs');
});

app.get('/about', (req, res) => {
  res.render('about.ejs');
});

app.get('/loggedinabout', (req, res) => {
  res.render('loggedinabout.ejs');
});

app.get('/favourites', (req, res) => {
  res.render('favourite.ejs');
});

//Handle saving favourites (via AJAX or form submission)
app.post('/save-favourite', (req, res) => {
  const carparkNumber = req.body.carparkNumber;
  // Implement the logic to save the favourite, e.e. store it in a database or array 

  res.status(200).send('Favourite saved successfully');
})


// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  //Temporarily log detailed errors in the catch block for debugging. 
  res.status(500).send('Error: ${err.message}');
  // res.status(500).send('Something went wrong!');
});


// Handle POST request for signup form
router.post('/signup', (req, res) => {
  const { name, email, password } = req.body;

  // Validate and sanitize user input here if needed
  if (password !== confirmPassword){
    // Passwords do not match, handle this case
    return res.render('signup', {error: 'Passwords do not match'});
  }

  // Insert user data into the 'userCredentials' table
  const query = 'INSERT INTO userCredentials (name, email, password) VALUES (?, ?, ?)';
  db.run(query, [name, email, password], (err) => {
    if (err) {
      console.error(err);
      // Handle the error, such as displaying an error message on the page
      res.render('signup', { error: 'Error creating an account.' });
    } else {
      // User account created successfully
      // Redirect to a success page or show a success message
      return res.render('/signup');  // You need to define this route and corresponding success page 
    }
  });
});

//app.use('/.netlify/home', router);
//module.exports.handler = serverless(app);

app.listen(port, () => console.log(`Example app listening on port ${port}!`));

