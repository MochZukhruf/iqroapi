const express = require('express');
const admin = require('firebase-admin');
const fileUpload = require('express-fileupload');
const fs = require('fs');

// Inisialisasi Firebase Admin SDK
const serviceAccount = require('./credential.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'firestoreiqro.appspot.com'
});
const db = admin.firestore();
const storage = admin.storage().bucket();

const app = express();
const port = 3000;

app.use(fileUpload());
app.use(express.json());

const getAccessToken = (fileName) => {
  const file = storage.file(fileName);
  return file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60, // 1 hour
  })
  .then(signedUrls => {
    return signedUrls[0];
  });
};


// Endpoint untuk mencari data berdasarkan titleName
app.get('/notifications', (req, res) => {
  const titleName = req.query.titleName;

  if (!titleName) {
    return res.status(400).send('titleName parameter is required');
  }

  db.collection('notifications').where('titleName', '==', titleName).get()
    .then(querySnapshot => {
      const notifications = [];
      
      querySnapshot.forEach((doc) => {
        notifications.push({
          id: doc.id,
          data: doc.data()
        });
      });

      if (notifications.length === 0) {
        return res.status(404).send('No notifications found');
      }

      res.status(200).json(notifications);
    })
    .catch(error => {
      console.error('Error fetching notifications:', error);
      res.status(500).send('Internal Server Error');
    });
});

// POST endpoint
app.post('/notifications', (req, res) => {
  const { titleName, detailNotification, dateNotification } = req.body;
  let imageUrl = '';

  if (req.files && req.files.imageNotification) {
    const image = req.files.imageNotification;

    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const tempFilePath = `${tempDir}/${Date.now()}_${image.name}`;
    const fileName = `images/${Date.now()}_${image.name}`;

    image.mv(tempFilePath, (err) => {
      if (err) {
        console.error('Error saving image:', err);
        return res.status(500).send('Internal Server Error');
      }

      const file = storage.file(fileName);

      file.save(fs.createReadStream(tempFilePath), {
        metadata: {
          contentType: image.mimetype
        }
      })
      .then(() => getAccessToken(fileName))
      .then(signedUrl => {
        imageUrl = signedUrl;
        fs.unlinkSync(tempFilePath);
        
        const notificationData = {
          titleName,
          detailNotification,
          imageNotification: imageUrl,
          dateNotification
        };
      
        return db.collection('notifications').add(notificationData);
      })
      .then(docRef => {
        const addedNotification = {
          id: docRef.id,
          data: {
            titleName,
            detailNotification,
            imageNotification: imageUrl,
            dateNotification
          }
        };
        res.status(201).json(addedNotification);
      })
      .catch(error => {
        console.error('Error adding notification:', error);
        res.status(500).send('Internal Server Error');
      });
    });
  } else {
    const notificationData = {
      titleName,
      detailNotification,
      imageNotification: imageUrl,
      dateNotification
    };

    db.collection('notifications').add(notificationData)
      .then(docRef => {
        const addedNotification = {
          id: docRef.id,
          data: notificationData
        };
        res.status(201).json(addedNotification);
      })
      .catch(error => {
        console.error('Error adding notification:', error);
        res.status(500).send('Internal Server Error');
      });
  }
});

// PUT endpoint
app.put('/notifications/:titleName', async (req, res) => {
  const titleName = req.params.titleName;
  const { detailNotification, dateNotification } = req.body;
  let imageUrl = '';

  // Check if a new image is uploaded
  if (req.files && req.files.imageNotification) {
    const image = req.files.imageNotification;

    // Save new image to temp directory
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const tempFilePath = `${tempDir}/${Date.now()}_${image.name}`;
    const fileName = `images/${Date.now()}_${image.name}`;

    try {
      await image.mv(tempFilePath);
      
      // Delete old image if exists
      const querySnapshot = await db.collection('notifications').where('titleName', '==', titleName).get();
      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const oldImageUrl = doc.data().imageNotification;
        
        if (oldImageUrl) {
          const oldFileName = oldImageUrl.split(`${storage.name}/`)[1].split('?')[0];
          const oldFile = storage.file(oldFileName);
          await oldFile.delete();
        }
      }

      // Save new image to Firebase storage
      const file = storage.file(fileName);
      await file.save(fs.createReadStream(tempFilePath), {
        metadata: {
          contentType: image.mimetype
        }
      });

      // Get signed URL for new image
      imageUrl = await getAccessToken(fileName);

      // Delete temp file
      fs.unlinkSync(tempFilePath);

    } catch (error) {
      console.error('Error uploading or deleting image:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  // Update notification data
  try {
    const querySnapshot = await db.collection('notifications').where('titleName', '==', titleName).get();
    
    if (querySnapshot.empty) {
      return res.status(404).send('Notification not found');
    }

    const docRef = db.collection('notifications').doc(querySnapshot.docs[0].id);
    let updateData = {};

    if (detailNotification) {
      updateData.detailNotification = detailNotification;
    }

    if (dateNotification) {
      updateData.dateNotification = dateNotification;
    }

    // If new image URL is available, update it
    if (imageUrl) {
      updateData.imageNotification = imageUrl;
    }

    await docRef.update(updateData);

    res.status(200).send('Notification updated successfully');

  } catch (error) {
    console.error('Error updating notification:', error);
    res.status(500).send('Internal Server Error');
  }
});



// DELETE endpoint berdasarkan titleName
app.delete('/notifications/:titleName', (req, res) => {
  const titleName = req.params.titleName;

  db.collection('notifications').where('titleName', '==', titleName).get()
    .then(querySnapshot => {
      if (querySnapshot.empty) {
        return res.status(404).send('Notification not found');  
      }

      const promises = [];
      querySnapshot.forEach(doc => {
        const docRef = db.collection('notifications').doc(doc.id);
        const imageUrl = doc.data().imageNotification;
        
        if (imageUrl) {
          const fileName = imageUrl.split(`${storage.name}/`)[1].split('?')[0]; // Menghapus parameter dari URL
          const file = storage.file(fileName);

          promises.push(file.delete()
            .then(() => {
              console.log(`Deleted file: ${fileName}`);
              return docRef.delete();
            })
            .catch(err => {
              console.error(`Error deleting file ${fileName}:`, err);
              throw err;
            }));
        } else {
          promises.push(docRef.delete()
            .catch(err => {
              console.error('Error deleting document:', err);
              throw err;
            }));
        }
      });

      return Promise.all(promises);
    })
    .then(() => {
      res.status(200).send('Notification deleted successfully');
    })
    .catch(error => {
      console.error('Error deleting notification:', error);
      if (error.code === 404 && error.errors && error.errors[0]) {
        const errorMsg = error.errors[0].message || 'Object not found';
        return res.status(404).send(errorMsg);
      }
      res.status(500).send('Internal Server Error');
    });
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
