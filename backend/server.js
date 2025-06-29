import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import session from 'express-session';
import { initDatabase, findOrCreateUser, findUserById, getBots, addMessage, getMessagesForUserBot, addBot, updateBot, deleteBot, getBotById, checkMessageLimit, getActivatedBotsForUser, activateBotForUser, addActivationKey, getConversationsForUserBot, deleteConversation, updateConversationTitle, getConversationById, addConversation, saveUserBotPreferences, getUserBotPreferences, getMySQLUserId, syncUserToMySQL, updateUserMySQLId } from './database.js';
import cors from 'cors';
import openai from './openai.js';

dotenv.config();

const app = express();

// Middleware pour vérifier l'authentification
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Non authentifié' });
}

// Configurer CORS pour autoriser les requêtes depuis le frontend
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

// Ajouter le middleware pour parser le JSON
app.use(express.json());

// Configurer le middleware de session
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretpar défaut',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    sameSite: 'Lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 heures
  }
}));

// Ajout de logs pour la configuration de session
console.log('Configuration de session:', {
  secret: process.env.SESSION_SECRET || 'supersecretpar défaut',
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'None',
  maxAge: 24 * 60 * 60 * 1000
});

// Configure Google OAuth strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback"
  },
  (accessToken, refreshToken, profile, done) => {
    // Utiliser la fonction findOrCreateUser pour gérer l'utilisateur dans la base de données
    try {
      const user = findOrCreateUser(profile.id, profile.displayName, profile.emails[0].value);
      done(null, user);
    } catch (err) {
      done(err);
    }
  }
));

// Initialiser Passport et la gestion de session
app.use(passport.initialize());
app.use(passport.session());

// Sérialisation et désérialisation de l'utilisateur (déplacées depuis database.js)
passport.serializeUser((user, done) => {
  console.log('Passport: server.js - serializeUser - User ID:', user.id);
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  console.log('Passport: server.js - deserializeUser - Received ID:', id);
  try {
    // Assurez-vous que findUserById est importé depuis database.js
    const user = findUserById(id);
    console.log('Passport: server.js - deserializeUser - Result from findUserById:', user);
    if (user) {
      console.log('Passport: server.js - deserializeUser - User found, calling done(null, user)');
      done(null, user);
    } else {
      console.log('Passport: server.js - deserializeUser - User not found for ID', id, ', calling done(null, false)');
      done(null, false); // User not found
    }
  } catch (err) {
    console.error('Passport: server.js - deserializeUser - Error during deserialization:', err);
    done(err); // Pass the error to Passport
  }
});

// Initialiser la base de données au démarrage du serveur
initDatabase();

// Route pour vérifier l'état de l'authentification (pour le frontend)
app.get('/auth/status', async (req, res) => {
  console.log('=== Début de la requête /auth/status ===');
  console.log('Headers:', req.headers);
  console.log('Raw Cookie Header:', req.headers.cookie);
  console.log('Cookies:', req.cookies);
  console.log('Session:', req.session);
  console.log('isAuthenticated:', req.isAuthenticated());
  console.log('User:', req.user);

  if (req.isAuthenticated()) {
    console.log('Utilisateur authentifié, ID:', req.user.id);
    const activatedBots = getActivatedBotsForUser(req.user.id);
    console.log('/auth/status - Bots activés pour l\'utilisateur:', activatedBots);
    const responseUser = { 
      id: req.user.id, 
      name: req.user.name, 
      email: req.user.email, 
      activatedBots: activatedBots.map(bot => bot.id),
      mysql_id: req.user.mysql_id
    };
    console.log('/auth/status - Envoi de la réponse user (authentifié): ', responseUser);
    res.status(200).json({ user: responseUser });
  } else {
    console.log('Utilisateur non authentifié');
    console.log('/auth/status - Envoi de la réponse user (non authentifié): ', null);
    res.status(200).json({ user: null });
  }
  console.log('=== Fin de la requête /auth/status ===');
});

// Route pour initier l'authentification Google
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Route de callback après l'authentification Google
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }), // Redirige vers une page de login en cas d'échec
  (req, res) => {
    // Authentification réussie, rediriger vers la page d'accueil ou un tableau de bord de l'application frontend
    // Tu devras peut-être rediriger vers une URL de ton application frontend
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:5173/'); // Utiliser l'URL du frontend
  }
);

// Route de déconnexion
app.get('/logout', (req, res, next) => {
  console.log('Received logout request');
  req.logout((err) => {
    if (err) {
      console.error('Erreur lors de la déconnexion:', err);
      return next(err);
    }
    // Au lieu de rediriger, envoyer une réponse JSON pour le frontend
    res.status(200).json({ message: 'Déconnexion réussie' });
  });
});

// Nouvelle route pour obtenir la liste de tous les utilisateurs
// Supprimée pour des raisons de sécurité
// app.get('/api/users', ...)

// Nouvelle route pour récupérer tous les bots
app.get('/api/bots', (req, res) => {
  try {
    const bots = getBots();
    res.status(200).json(bots);
  } catch (error) {
    console.error('Erreur lors de la récupération des bots:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des bots' });
  }
});

// Route pour créer un nouveau bot
app.post('/api/bots', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  const { name, description, price, category, image, prompt } = req.body;
  
  try {
    const botId = addBot(name, description, price, category, image, prompt);
    res.status(201).json({ message: 'Bot créé avec succès', botId });
  } catch (error) {
    console.error('Erreur lors de la création du bot:', error);
    res.status(500).json({ message: 'Erreur lors de la création du bot' });
  }
});

// Route pour mettre à jour un bot
app.put('/api/bots/:id', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  const botId = Number(req.params.id); // Convertir l'ID en nombre
  console.log('PUT /api/bots/:id - Received ID:', botId); // Log the received ID
  const { name, description, price, category, image, prompt } = req.body;
  console.log('PUT /api/bots/:id - Received body:', req.body); // Log the received body
  
  try {
    updateBot(botId, name, description, price, category, image, prompt);
    res.status(200).json({ message: 'Bot mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du bot:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du bot' });
  }
});

// Route pour supprimer un bot
app.delete('/api/bots/:id', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  const botId = req.params.id;
  
  try {
    deleteBot(botId);
    res.status(200).json({ message: 'Bot supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression du bot:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du bot' });
  }
});

// Nouvelle route pour activer un bot pour un utilisateur
app.post('/api/activate-bot', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Non authentifié.' });
  }

  const { botId, key } = req.body;
  const userId = req.user.id; // L'ID de l'utilisateur connecté

  if (!botId || !key) {
    return res.status(400).json({ message: 'Bot ID et clé d\'activation sont requis.' });
  }

  try {
    const result = activateBotForUser(userId, botId, key);

    if (result.success) {
      if (result.message === 'Bot déjà activé.') {
        res.status(200).json({ message: result.message });
      } else {
        res.status(201).json({ message: result.message });
      }
    } else {
      res.status(400).json({ message: result.message });
    }

  } catch (error) {
    console.error('Erreur lors de l\'activation du bot:', error);
    res.status(500).json({ message: 'Une erreur est survenue lors de l\'activation du bot.' });
  }
});

// Nouvelle route pour récupérer les messages pour un utilisateur et un bot spécifiques
app.get('/api/messages', async (req, res) => {
  console.log('=== Début de la requête /api/messages ===');
  console.log('Headers:', req.headers);
  console.log('Cookies:', req.cookies);
  console.log('Session (avant Passport): ', req.session);
  console.log('isAuthenticated (après Passport): ', req.isAuthenticated());
  console.log('User (après Passport): ', req.user);

  // Commenter temporairement la vérification d'authentification
  // if (!req.isAuthenticated()) {
  //   console.log('/api/messages - Non authentifié après Passport');
  //   return res.status(401).json({ message: 'Non authentifié' });
  // }

  console.log('/api/messages - Authentifié (vérification temporairement désactivée) ou non authentifié');
  const userId = req.query.userId;
  const botId = Number(req.query.botId);

  // Récupérer l'identifiant de conversation, utiliser 0 par défaut si non spécifié
  const conversationId = Number(req.query.conversationId) || 0;

  if (!userId || isNaN(botId)) {
    console.error('/api/messages - Missing userId or invalid botId', { userId, botId });
    return res.status(400).json({ message: 'userId et botId sont requis' });
  }

  try {
    const messages = await getMessagesForUserBot(userId, botId, conversationId);
    console.log('/api/messages - Messages récupérés:', messages.length);
    res.status(200).json(messages);
  } catch (error) {
    console.error('Erreur lors de la récupération des messages:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des messages' });
  }
  console.log('=== Fin de la requête /api/messages ===');
});

// Route pour interagir avec l'API OpenAI (renommée en /api/chat)
app.post('/api/chat', async (req, res) => {
  console.log('=== Début de la requête /api/chat ===');
  console.log('Headers:', req.headers);
  console.log('Cookies:', req.cookies);
  console.log('Session (avant Passport): ', req.session);
  console.log('isAuthenticated (après Passport): ', req.isAuthenticated());
  console.log('User (après Passport): ', req.user);

  if (!req.isAuthenticated()) {
    console.log('/api/chat - Non authentifié après Passport');
    return res.status(401).json({ message: 'Non authentifié' });
  }

  console.log('/api/chat - Utilisateur authentifié, ID:', req.user.id);
  const { message, botId, conversationId, title } = req.body;

  if (!message || botId === undefined) {
    return res.status(400).json({ message: 'Message et botId sont requis' });
  }

  let currentConversationId = Number(conversationId);
  let conversationTitle = title;

  if (currentConversationId <= 0 || !(await getConversationById(currentConversationId))) {
    try {
      const newConvTitle = conversationTitle || 'Nouvelle conversation';
      currentConversationId = await addConversation(req.user.id, botId, newConvTitle);
      console.log('Nouvelle conversation créée avec ID:', currentConversationId);
    } catch (convError) {
      console.error('Erreur lors de la création de la conversation:', convError);
      return res.status(500).json({ message: 'Erreur lors de la création de la conversation.' });
    }
  } else if (title && currentConversationId > 0) {
    try {
      await updateConversationTitle(req.user.id, Number(botId), Number(conversationId), title);
      console.log(`Titre de la conversation ${currentConversationId} mis à jour.`);
    } catch (titleUpdateError) {
      console.error(`Erreur lors de la mise à jour du titre de la conversation ${currentConversationId}:`, titleUpdateError);
    }
  }

  try {
    // Récupérer le bot pour obtenir le prompt
    const bot = getBotById(botId);

    if (!bot) {
      return res.status(404).json({ message: 'Bot non trouvé' });
    }

    const prompt = bot.prompt || 'You are a helpful assistant.';

    // Récupérer les 10 derniers messages pour le contexte de cette conversation
    const conversationHistory = await getMessagesForUserBot(req.user.id, botId, currentConversationId, 10);

    const messagesForGpt = [
      { role: "system", content: prompt }
    ];

    // Ajouter l'historique de la conversation au format attendu par l'API OpenAI
    conversationHistory.forEach(msg => {
      messagesForGpt.push({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text
      });
    });

    // Ajouter le message actuel de l'utilisateur
    messagesForGpt.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Utilisation d'un modèle plus récent
      messages: messagesForGpt,
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = completion.choices[0].message.content;

    await addMessage(req.user.id, botId, currentConversationId, 'user', message);
    await addMessage(req.user.id, botId, currentConversationId, 'bot', reply);

    res.status(200).json({ message: reply });

  } catch (error) {
    console.error('Erreur lors de l\'interaction avec OpenAI:', error);
    // Gérer spécifiquement les erreurs de limite de message si nécessaire
    if (error.message && error.message.includes('Message limit reached')) {
       res.status(403).json({ message: error.message });
    } else {
       res.status(500).json({ message: 'Une erreur est survenue lors de l\'interaction avec le bot' });
    }
  }
});

// Middleware de gestion des erreurs global
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  
  // Déterminer le type d'erreur et envoyer une réponse appropriée
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  
  // Erreur par défaut
  res.status(500).json({ 
    message: 'Une erreur interne est survenue',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Nouvelle route pour générer des clés d'activation (pour l'administrateur)
app.post('/api/generate-keys', (req, res) => {
  if (!req.isAuthenticated() || req.user.email !== 'mohammadharris200528@gmail.com') { // Vérifier si l'utilisateur est admin
    return res.status(403).json({ message: 'Accès refusé. Réservé à l\'administrateur.' });
  }

  const { botId, numberOfKeys } = req.body;

  if (!botId || !numberOfKeys || numberOfKeys <= 0) {
    return res.status(400).json({ message: 'botId et numberOfKeys (nombre > 0) sont requis' });
  }

  try {
    const generatedKeys = [];
    for (let i = 0; i < numberOfKeys; i++) {
        // Générer une clé unique (simple UUID pour l'exemple)
        const key = `${botId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`; // Génération simple, à améliorer pour la production si nécessaire
        addActivationKey(key, botId);
        generatedKeys.push(key);
    }
    res.status(201).json({ message: 'Clés générées avec succès', keys: generatedKeys });
  } catch (error) {
    console.error('Erreur détaillée lors de la génération des clés:', error); // Log détaillé de l'erreur
    res.status(500).json({ message: 'Erreur lors de la génération des clés', error: error.message }); // Inclure le message d'erreur dans la réponse
  }
});

// Nouvelle route pour sauvegarder les préférences utilisateur par bot
app.post('/api/bot-preferences', isAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { botId, preferences } = req.body;

  if (!botId || !preferences) {
    return res.status(400).json({ message: 'Bot ID et préférences sont requis.' });
  }

  try {
    saveUserBotPreferences(userId, botId, preferences);
    res.status(200).json({ message: 'Préférences sauvegardées avec succès.' });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des préférences:', error);
    res.status(500).json({ message: 'Erreur lors de la sauvegarde des préférences.' });
  }
});

// Modifier la route pour récupérer les conversations afin d'inclure les préférences
app.get('/api/conversations/:botId', isAuthenticated, (req, res) => {
  const userId = req.user.id;
  const botId = Number(req.params.botId);

  try {
    const conversations = getConversationsForUserBot(userId, botId);
    const preferences = getUserBotPreferences(userId, botId);
    
    res.status(200).json({ conversations, preferences });
  } catch (error) {
    console.error('Erreur lors de la récupération des conversations et préférences:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des conversations et préférences.' });
  }
});

// Route pour supprimer une conversation
app.delete('/api/conversations/:botId/:conversationId', isAuthenticated, async (req, res) => {
  try {
    const { botId, conversationId } = req.params;
    const userId = req.user.id;

    console.log(`Attempting to delete conversation ${conversationId} for user ${userId} and bot ${botId}`);

    const success = await deleteConversation(userId, botId, conversationId);
    
    if (success) {
      console.log(`Conversation ${conversationId} deleted successfully.`);
      res.json({ success: true });
    } else {
      console.warn(`Conversation ${conversationId} not found or not deleted.`);
      res.status(404).json({ error: 'Conversation non trouvée' });
    }
  } catch (error) {
    console.error('Erreur lors de la suppression de la conversation:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de la conversation' });
  }
});

// Route pour mettre à jour le titre d'une conversation
app.put('/api/conversations/:botId/:conversationId/title', isAuthenticated, async (req, res) => {
  try {
    const { botId, conversationId } = req.params;
    const userId = req.user.id;
    const { title } = req.body;

    console.log(`Received PUT request to update title for conversation ${conversationId}, bot ${botId}, user ${userId} with new title: ${title}`);

    if (!title) {
      console.log('Title is missing from request body.');
      return res.status(400).json({ error: 'Le titre est requis' });
    }

    // Utiliser la nouvelle fonction de la base de données pour mettre à jour le titre
    const success = await updateConversationTitle(userId, Number(botId), Number(conversationId), title);

    if (success) {
      console.log(`Title updated successfully for conversation ${conversationId}.`);
      res.json({ success: true });
    } else {
      console.warn(`Conversation ${conversationId} not found or title not updated.`);
      res.status(404).json({ error: 'Conversation non trouvée ou aucun message à mettre à jour' });
    }

  } catch (error) {
    console.error('Erreur lors de la mise à jour du titre de la conversation:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du titre de la conversation' });
  }
});

// Route pour rechercher des messages dans une conversation spécifique
app.get('/api/messages/:botId/:conversationId/search', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const botId = parseInt(req.params.botId);
  const conversationId = parseInt(req.params.conversationId);
  const query = req.query.query;

  if (!userId || isNaN(botId) || isNaN(conversationId) || !query || typeof query !== 'string') {
    return res.status(400).send('Paramètres manquants ou invalides.');
  }

  try {
    const messages = await database.searchMessages(userId, botId, conversationId, query);
    res.json(messages);
  } catch (error) {
    console.error('Erreur lors de la recherche de messages:', error);
    res.status(500).send('Erreur interne du serveur.');
  }
});

// Route pour récupérer l'ID MySQL d'un utilisateur connecté
app.get('/api/user/mysql-id', isAuthenticated, (req, res) => {
  try {
    const mysqlUserId = getMySQLUserId(req.user.id);
    if (mysqlUserId) {
      res.json({ success: true, mysqlUserId });
    } else {
      res.status(404).json({ success: false, message: 'ID MySQL non trouvé pour cet utilisateur' });
    }
  } catch (error) {
    console.error('Erreur récupération ID MySQL:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Route de test pour forcer la synchronisation d'un utilisateur vers MySQL
app.get('/api/test/sync-user', isAuthenticated, async (req, res) => {
  try {
    console.log('🔄 Test de synchronisation forcée pour:', req.user.name);
    
    // Forcer la synchronisation
    const mysqlUserId = await syncUserToMySQL(req.user.id, req.user.name, req.user.email);
    
    if (mysqlUserId) {
      // Mettre à jour l'utilisateur SQLite avec l'ID MySQL
      updateUserMySQLId(req.user.id, mysqlUserId);
      console.log('✅ Synchronisation forcée réussie:', mysqlUserId);
      
      res.json({ 
        success: true, 
        message: 'Synchronisation réussie',
        mysqlUserId,
        user: req.user
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Échec de la synchronisation'
      });
    }
  } catch (error) {
    console.error('❌ Erreur synchronisation forcée:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

// Route pour créer une nouvelle conversation
app.post('/api/conversations', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const { botId, title } = req.body;
    if (!botId) {
      return res.status(400).json({ message: 'botId requis' });
    }
    const convTitle = title || 'Nouvelle conversation';
    const conversationId = await addConversation(userId, botId, convTitle);
    const conversation = getConversationById(conversationId);
    res.status(201).json(conversation);
  } catch (error) {
    console.error('Erreur lors de la création de la conversation:', error);
    res.status(500).json({ message: 'Erreur lors de la création de la conversation.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur le port ${PORT}`);
}); 