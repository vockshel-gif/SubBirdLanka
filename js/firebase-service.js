/**
 * SunBird Lanka Tours — Firebase Integration Service
 * Handles uploading generated and custom PDFs to Firebase Storage,
 * saving metadata to Firebase Realtime Database, and generating
 * secure, unguessable client links.
 */

(function (window) {
  'use strict';

  // Official Firebase Configuration provided by SunBird
  const firebaseConfig = {
    apiKey: "AIzaSyAjK5tOWOH1BvmRwf_F6E7n1mjCgDvCMeM",
    authDomain: "subbird-a75d3.firebaseapp.com",
    databaseURL: "https://subbird-a75d3-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "subbird-a75d3",
    storageBucket: "subbird-a75d3.firebasestorage.app",
    messagingSenderId: "744521785517",
    appId: "1:744521785517:web:9ac8047585be0f9fb3e624",
    measurementId: "G-HXPR5Q3RYP"
  };

  // Base domain for client itinerary links on SubBirdLanka GitHub host
  const CLIENT_HOST_BASE = "https://vockshel-gif.github.io/SubBirdLanka/view.html?id=";
  const LOCAL_VIEWER_BASE = "view.html?id=";

  let isInitialized = false;
  let app = null;
  let storage = null;
  let database = null;

  function initFirebase() {
    if (isInitialized) return true;
    if (typeof firebase === 'undefined') {
      console.error('Firebase SDK not loaded. Please include firebase-app, firebase-storage, and firebase-database.');
      return false;
    }
    try {
      if (!firebase.apps.length) {
        app = firebase.initializeApp(firebaseConfig);
      } else {
        app = firebase.app();
      }
      storage = firebase.storage();
      database = firebase.database();
      isInitialized = true;
      console.log('SunBird Firebase service initialized successfully.');
      return true;
    } catch (err) {
      console.error('Error initializing Firebase:', err);
      return false;
    }
  }

  // Generate a cryptographically strong UUID v4
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Convert Blob or File to Base64 Data URL
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Uploads a PDF Blob or File to Firebase.
   * Resilient implementation: Converts to Base64 for instant Realtime Database
   * persistence (bypassing any browser origin: 'null' / Storage CORS preflight blocks),
   * while also attempting Storage upload when available.
   *
   * @param {Blob|File} pdfData - The PDF blob or file to upload
   * @param {string} customId - Optional custom UUID
   * @param {function} onProgress - Optional progress callback: (percent) => {}
   * @returns {Promise<{ id: string, downloadUrl: string, pdfBase64: string, storagePath: string }>}
   */
  async function uploadPDF(pdfData, customId = null, onProgress = null) {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');

    const id = customId || generateUUID();
    let pdfBase64 = null;

    if (onProgress) onProgress(20);

    // 1. Encode to Base64 for resilient cloud DB storage
    try {
      pdfBase64 = await blobToBase64(pdfData);
      if (onProgress) onProgress(50);
    } catch (e) {
      console.warn('Could not encode PDF to base64:', e);
    }

    let downloadUrl = '';
    const storagePath = `itineraries/${id}.pdf`;

    // 2. Attempt Storage upload only if running via HTTP/HTTPS and storage bucket is available
    if (storage && window.location.protocol.startsWith('http')) {
      try {
        const storageRef = storage.ref(storagePath);
        const metadata = {
          contentType: 'application/pdf',
          customMetadata: {
            itineraryId: id,
            uploadedAt: new Date().toISOString()
          }
        };

        const uploadTask = storageRef.put(pdfData, metadata);

        await new Promise((resolve) => {
          // Timeout guard in case preflight hangs
          const timer = setTimeout(() => resolve(), 3500);

          uploadTask.on(
            firebase.storage.TaskEvent.STATE_CHANGED,
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              if (onProgress) onProgress(50 + Math.round(progress * 0.4));
            },
            (error) => {
              clearTimeout(timer);
              console.warn('Firebase Storage upload not available (saved securely via Realtime Database):', error.message || error);
              resolve();
            },
            async () => {
              clearTimeout(timer);
              try {
                downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();
              } catch (e) {}
              resolve();
            }
          );
        });
      } catch (err) {
        console.warn('Firebase Storage skipped (fallback to Realtime Database):', err.message || err);
      }
    }

    if (onProgress) onProgress(100);

    return {
      id,
      downloadUrl,
      pdfBase64,
      storagePath
    };
  }

  /**
   * Saves itinerary metadata into Firebase Realtime Database
   * @param {Object} record - { id, title, type, pdfUrl, pdfBase64, ... }
   */
  async function saveRecord(record) {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');
    if (!record.id) throw new Error('Record must have an id.');

    const cleanRecord = {
      id: record.id,
      title: record.title || 'SunBird Lanka Tours Itinerary',
      type: record.type || 'classic_generated', // 'classic_generated' or 'custom_pdf'
      pdfUrl: record.pdfUrl || '',
      pdfBase64: record.pdfBase64 || '',
      from: record.from || '',
      to: record.to || '',
      adults: record.adults || '',
      clientName: record.clientName || '',
      fileName: record.fileName || `${record.id}.pdf`,
      createdAt: record.createdAt || Date.now(),
      data: record.data || null
    };

    await database.ref(`itineraries/${record.id}`).set(cleanRecord);
    return cleanRecord;
  }

  /**
   * Fetches an itinerary by ID from Firebase Realtime Database
   * @param {string} id
   */
  async function getRecord(id) {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');
    try {
      const snapshot = await database.ref(`itineraries/${id}`).once('value');
      if (snapshot.exists()) {
        return snapshot.val();
      }
    } catch (dbErr) {
      console.warn('Realtime Database lookup error:', dbErr);
    }

    // Fallback: check if the file exists directly in storage
    try {
      const storageRef = storage.ref(`itineraries/${id}.pdf`);
      const downloadUrl = await storageRef.getDownloadURL();
      return {
        id: id,
        title: 'Official Tour Itinerary & Quotation',
        type: 'custom_pdf',
        pdfUrl: downloadUrl,
        createdAt: Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Lists all published itineraries and client links from Firebase Realtime Database
   * @returns {Promise<Array<Object>>}
   */
  async function listRecords() {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');
    try {
      const snapshot = await database.ref('itineraries').once('value');
      if (!snapshot.exists()) return [];
      const val = snapshot.val();
      const records = [];
      for (const id in val) {
        if (Object.prototype.hasOwnProperty.call(val, id)) {
          const item = val[id];
          if (item && typeof item === 'object') {
            records.push({
              id: id,
              ...item
            });
          }
        }
      }
      // Sort newest first
      records.sort((a, b) => {
        const timeA = a.updatedAt || a.createdAt || 0;
        const timeB = b.updatedAt || b.createdAt || 0;
        return timeB - timeA;
      });
      return records;
    } catch (err) {
      console.error('Error fetching itinerary records from Firebase:', err);
      throw err;
    }
  }

  /**
   * Permanently deletes an itinerary record and its PDF from Firebase
   * @param {string} id
   */
  async function deleteRecord(id) {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');
    if (!id) throw new Error('Itinerary ID is required for deletion.');

    // 1. Delete from Realtime Database
    await database.ref(`itineraries/${id}`).remove();

    // 2. Delete from Storage if it exists
    if (storage) {
      try {
        const storageRef = storage.ref(`itineraries/${id}.pdf`);
        await storageRef.delete();
      } catch (storageErr) {
        // Storage file may not exist or CORS preflight on delete; database deletion is primary
        console.warn('Firebase Storage file removal notice:', storageErr.message || storageErr);
      }
    }
    return true;
  }

  /**
   * Re-uploads / updates a PDF for an existing client link ID
   * @param {string} id - The existing itinerary link ID
   * @param {Blob|File} newPdfData - The updated PDF binary
   * @param {string} newTitle - Optional updated title
   * @param {function} onProgress - Optional progress callback
   */
  async function updateRecordPDF(id, newPdfData, newTitle = null, onProgress = null) {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');
    if (!id) throw new Error('Itinerary ID is required for update.');
    if (!newPdfData) throw new Error('Updated PDF file is required.');

    if (onProgress) onProgress(20);

    // 1. Encode new PDF to Base64
    let pdfBase64 = null;
    try {
      pdfBase64 = await blobToBase64(newPdfData);
      if (onProgress) onProgress(50);
    } catch (e) {
      console.warn('Could not encode updated PDF to base64:', e);
    }

    // 2. Attempt Storage re-upload if available
    let downloadUrl = '';
    const storagePath = `itineraries/${id}.pdf`;
    if (storage && window.location.protocol.startsWith('http')) {
      try {
        const storageRef = storage.ref(storagePath);
        const metadata = {
          contentType: 'application/pdf',
          customMetadata: {
            itineraryId: id,
            updatedAt: new Date().toISOString()
          }
        };

        const uploadTask = storageRef.put(newPdfData, metadata);
        await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(), 3500);
          uploadTask.on(
            firebase.storage.TaskEvent.STATE_CHANGED,
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              if (onProgress) onProgress(50 + Math.round(progress * 0.4));
            },
            (error) => {
              clearTimeout(timer);
              resolve();
            },
            async () => {
              clearTimeout(timer);
              try { downloadUrl = await uploadTask.snapshot.ref.getDownloadURL(); } catch (e) {}
              resolve();
            }
          );
        });
      } catch (err) {
        console.warn('Storage update notice:', err);
      }
    }

    if (onProgress) onProgress(90);

    // 3. Update Realtime Database
    const updates = {
      updatedAt: Date.now()
    };
    if (pdfBase64) updates.pdfBase64 = pdfBase64;
    if (downloadUrl) updates.pdfUrl = downloadUrl;
    if (newTitle) updates.title = newTitle;
    if (newPdfData.name) updates.fileName = newPdfData.name;

    await database.ref(`itineraries/${id}`).update(updates);

    if (onProgress) onProgress(100);

    return {
      id,
      downloadUrl,
      pdfBase64
    };
  }

  /**
   * Updates itinerary metadata without changing the PDF
   * @param {string} id
   * @param {Object} meta
   */
  async function updateRecordMeta(id, meta) {
    if (!initFirebase()) throw new Error('Firebase could not be initialized.');
    if (!id) throw new Error('Itinerary ID is required.');
    const updates = {
      ...meta,
      updatedAt: Date.now()
    };
    await database.ref(`itineraries/${id}`).update(updates);
    return true;
  }

  /**
   * Returns the final client link for a given itinerary ID
   */
  function getClientLink(id, useLocal = false) {
    const base = useLocal ? LOCAL_VIEWER_BASE : CLIENT_HOST_BASE;
    return `${base}${id}`;
  }

  // Export service object
  window.SunBirdFirebase = {
    init: initFirebase,
    generateUUID: generateUUID,
    uploadPDF: uploadPDF,
    saveRecord: saveRecord,
    getRecord: getRecord,
    listRecords: listRecords,
    deleteRecord: deleteRecord,
    updateRecordPDF: updateRecordPDF,
    updateRecordMeta: updateRecordMeta,
    getClientLink: getClientLink,
    CLIENT_HOST_BASE: CLIENT_HOST_BASE,
    LOCAL_VIEWER_BASE: LOCAL_VIEWER_BASE
  };

})(window);
