import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, 'users.db');
const db = new Database(dbPath, { verbose: console.log }); // `verbose` pour débugging

// Fonction pour initialiser la base de données (créer les tables si elles n'existent pas)
const initDatabase = () => {
  // Créer les tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      googleId TEXT UNIQUE,
      name TEXT,
      email TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL,
      category TEXT,
      image TEXT,
      prompt TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      botId INTEGER,
      title TEXT,
      status INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      botId INTEGER,
      conversationId INTEGER,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      context TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_bots (
      userId TEXT,
      botId INTEGER,
      PRIMARY KEY (userId, botId),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activation_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      botId INTEGER,
      is_used BOOLEAN,
      used_by_userId TEXT,
      used_at DATETIME
    );

    -- Nouvelle table pour les préférences utilisateur par bot
    CREATE TABLE IF NOT EXISTS user_bot_preferences (
      userId TEXT,
      botId INTEGER,
      preferences TEXT, -- Stocker les préférences (y compris le thème) en JSON
      PRIMARY KEY (userId, botId),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );
  `);

  // Vérifier et ajouter la colonne status si nécessaire
  try {
    db.prepare('SELECT status FROM conversations LIMIT 1').get();
  } catch (e) {
    console.log('Ajout de la colonne status à la table conversations...');
    db.prepare('ALTER TABLE conversations ADD COLUMN status INTEGER DEFAULT 0').run();
  }

  // Vérifier et ajouter la colonne updatedAt si nécessaire
  try {
    db.prepare('SELECT updatedAt FROM conversations LIMIT 1').get();
  } catch (e) {
    console.log('Ajout de la colonne updatedAt à la table conversations...');
    db.prepare('ALTER TABLE conversations ADD COLUMN updatedAt DATETIME').run();
    db.prepare('UPDATE conversations SET updatedAt = createdAt WHERE updatedAt IS NULL').run();
  }

  // Vérifier si la colonne context existe dans la table messages
  const tableInfo = db.prepare("PRAGMA table_info(messages)").all();
  const hasContextColumn = tableInfo.some(column => column.name === 'context');
  
  if (!hasContextColumn) {
    console.log('Ajout de la colonne context à la table messages...');
    db.exec('ALTER TABLE messages ADD COLUMN context TEXT');
  }

  // Vérifier si la colonne conversationId existe dans la table messages
  const hasConversationIdColumn = tableInfo.some(column => column.name === 'conversationId');

  if (!hasConversationIdColumn) {
    console.log('Ajout de la colonne conversationId à la table messages...');
    db.exec('ALTER TABLE messages ADD COLUMN conversationId INTEGER DEFAULT 0'); // Utiliser 0 comme ID de conversation par défaut
  }

  // Vérifier si la colonne title existe dans la table messages
  const hasTitleColumn = tableInfo.some(column => column.name === 'title');

  if (!hasTitleColumn) {
    console.log('Ajout de la colonne title à la table messages...');
    db.exec('ALTER TABLE messages ADD COLUMN title TEXT');
  }

  console.log('Database initialized and tables ensured.');

  // Insérer des bots par défaut si la table est vide
  const botsCount = db.prepare('SELECT COUNT(*) FROM bots').get()['COUNT(*)'];
  if (botsCount === 0) {
    const insertBot = db.prepare('INSERT INTO bots (name, description, price, category, image, prompt) VALUES (?, ?, ?, ?, ?, ?)');
    insertBot.run('Assistant Islamique', 'Posez vos questions sur l\'islam, le Coran et les hadiths', 9.99, 'Religion', '/islamic-bot.png', "Tu es un assistant islamique bienveillant. Tu expliques l\'islam avec douceur, sagesse et respect. Tu cites toujours tes sources : versets du Coran (avec numéro de sourate et verset), hadiths authentiques (avec référence), ou avis de savants connus. Si tu ne connais pas la réponse, dis-le avec bienveillance. Tu t\'exprimes comme un ami proche, rassurant et sincère.");
    insertBot.run('Assistant Juridique', 'Conseils juridiques et aide à la compréhension du droit', 14.99, 'Droit', '/legal-bot.png', 'Vous êtes un assistant virtuel juridique spécialisé en droit français. Votre rôle est de fournir des informations générales et une aide à la compréhension du droit **en vous basant sur l\'historique complet de la conversation fourni.** Répondez à la question la plus récente de l\'utilisateur en tenant compte de ce qui a été dit précédemment. Ne donnez pas de conseils juridiques personnalisés.');
    insertBot.run('Assistant Santé', 'Conseils santé et bien-être personnalisés', 12.99, 'Santé', '/health-bot.png', 'Vous êtes un assistant virtuel santé. Votre rôle est de fournir des informations générales et des conseils sur la santé et le bien-être. Ne remplacez pas l\'avis d\'un professionnel de santé.');
    console.log('Default bots inserted.');
  }
};

// Fonction pour trouver ou créer un utilisateur
const findOrCreateUser = (googleId, name, email) => {
  const user = db.prepare('SELECT * FROM users WHERE googleId = ?').get(googleId);

  if (user) {
    console.log('User found:', user);
    return user;
  } else {
    console.log('User not found, creating new user...');
    const newUser = db.prepare('INSERT INTO users (id, googleId, name, email) VALUES (?, ?, ?, ?)').run(
      googleId, // Utiliser googleId comme id interne ou générer un autre UUID si préféré
      googleId,
      name,
      email
    );
    const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(googleId);
    console.log('User created:', createdUser);
    return createdUser;
  }
};

// Fonction pour trouver un utilisateur par son ID (pour la désérialisation Passport)
const findUserById = (id) => {
  console.log('DB: findUserById - Attempting to find user with ID:', id);
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    console.log('DB: findUserById - Result for ID', id, ':', user);
    return user;
  } catch (err) {
    console.error('DB: findUserById - Error finding user with ID', id, ':', err);
    throw err; // Rethrow the error so it can be caught by deserializeUser
  }
};

// Fonction pour récupérer tous les utilisateurs (maintenant non utilisée par le frontend public)
const getAllUsers = () => {
  const users = db.prepare('SELECT id, name, email FROM users').all();
  console.log('Fetching all users:', users);
  return users;
};

// Nouvelle fonction pour récupérer tous les bots
const getBots = () => {
  const bots = db.prepare('SELECT * FROM bots').all();
  console.log('Fetching all bots:', bots);
  return bots;
};

// Nouvelle fonction pour récupérer un bot par son ID
const getBotById = (botId) => {
  const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(botId);
  console.log('Fetching bot by ID:', botId, '- Found:', bot);
  return bot;
};

// Fonction pour ajouter un message
function addMessage(userId, botId, conversationId, sender, text, context = null) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO messages (userId, botId, conversationId, sender, text, context)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(userId, botId, conversationId, sender, text, context);
      resolve(result.lastInsertRowid);
    } catch (err) {
      console.error('Erreur lors de l\'ajout du message:', err);
      reject(err);
    }
  });
}

// Fonction pour récupérer les messages
function getMessagesForUserBot(userId, botId, conversationId = 0, limit = 10) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(`
        SELECT sender, text
        FROM messages
        WHERE userId = ? AND botId = ? AND conversationId = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      
      // Exécuter la requête et inverser l'ordre pour avoir l'historique du plus ancien au plus récent
      const messages = stmt.all(userId, botId, conversationId, limit).reverse();
      resolve(messages);
    } catch (err) {
      console.error('Erreur lors de la récupération des messages:', err);
      reject(err);
    }
  });
}

// Fonction pour ajouter un nouveau bot
export function addBot(name, description, price, category, image, prompt) {
  const stmt = db.prepare(`
    INSERT INTO bots (name, description, price, category, image, prompt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, description, price, category, image, prompt);
  return result.lastInsertRowid;
}

// Fonction pour mettre à jour un bot
export function updateBot(id, name, description, price, category, image, prompt) {
  const stmt = db.prepare(`
    UPDATE bots
    SET name = ?, description = ?, price = ?, category = ?, image = ?, prompt = ?
    WHERE id = ?
  `);
  const result = stmt.run(name, description, price, category, image, prompt, id);
  if (result.changes === 0) {
    throw new Error('Bot non trouvé');
  }
  return result.changes;
}

// Fonction pour supprimer un bot
export function deleteBot(id) {
  const stmt = db.prepare('DELETE FROM bots WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes === 0) {
    throw new Error('Bot non trouvé');
  }
  return result.changes;
}

// Fonction pour compter les messages d'un utilisateur pour un bot spécifique
const countUserMessages = (userId, botId) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE userId = ? AND botId = ? AND sender = ?').get(userId, botId, 'user')['count'];
  return count;
};

// Fonction pour vérifier si un bot est activé pour un utilisateur
const isBotActivatedForUser = (userId, botId) => {
  const activated = db.prepare('SELECT COUNT(*) as count FROM user_bots WHERE userId = ? AND botId = ?').get(userId, botId)['count'] > 0;
  return activated;
};

// Fonction pour vérifier si l'utilisateur a atteint sa limite de messages
const checkMessageLimit = (userId, botId, email) => {
  // Si c'est l'admin, pas de limite
  if (email === 'mohammadharris200528@gmail.com') {
    return { canSend: true, remaining: Infinity };
  }
  
  // Si le bot est activé pour l'utilisateur, pas de limite
  if (isBotActivatedForUser(userId, botId)) {
    return { canSend: true, remaining: Infinity };
  }
  
  const messageCount = countUserMessages(userId, botId);
  const limit = 100;
  const remaining = limit - messageCount;
  
  return {
    canSend: messageCount < limit,
    remaining: remaining
  };
};

// Fonction pour activer un bot pour un utilisateur avec une clé
const activateBotForUser = (userId, botId, key) => {
  // 1. Trouver la clé dans la table activation_keys
  const keyInfo = db.prepare('SELECT * FROM activation_keys WHERE key = ?').get(key);

  if (!keyInfo) {
    throw new Error('Clé invalide');
  }

  if (keyInfo.is_used) {
    throw new Error('Clé déjà utilisée');
  }

  if (keyInfo.botId !== botId) {
      throw new Error('Clé non valide pour ce bot');
  }

  // 2. Marquer la clé comme utilisée
  db.prepare('UPDATE activation_keys SET is_used = 1, used_by_userId = ?, used_at = CURRENT_TIMESTAMP WHERE key = ?').run(userId, key);

  // 3. Associer l'utilisateur au bot dans user_bots
  // Utiliser INSERT OR IGNORE au cas où l'utilisateur aurait déjà ce bot activé (ce qui ne devrait pas arriver avec la clé, mais sécurité)
  const result = db.prepare('INSERT OR IGNORE INTO user_bots (userId, botId) VALUES (?, ?)').run(userId, botId);

  return result.changes > 0; // Retourne true si l'insertion a eu lieu (nouvelle activation)
};

// Fonction pour obtenir les bots activés pour un utilisateur
const getActivatedBotsForUser = (userId) => {
  const bots = db.prepare(`
    SELECT b.* FROM bots b
    JOIN user_bots ub ON b.id = ub.botId
    WHERE ub.userId = ?
  `).all(userId);
  return bots;
};

// Fonction pour ajouter une clé d'activation (utile pour l'admin)
const addActivationKey = (key, botId) => {
    const stmt = db.prepare('INSERT INTO activation_keys (key, botId, is_used) VALUES (?, ?, 0)');
    const result = stmt.run(key, botId);
    return result.lastInsertRowid;
};

// Nouvelle fonction pour récupérer les conversations avec leurs titres
const getConversationsForUserBot = (userId, botId) => {
  console.log('DB: getConversationsForUserBot - Fetching conversations for user', userId, 'and bot', botId);
  const stmt = db.prepare(`
    SELECT c.id, c.title, c.status, c.createdAt
    FROM conversations c
    WHERE c.userId = ? AND c.botId = ?
    ORDER BY c.createdAt DESC
  `);
  const conversations = stmt.all(userId, botId);
  console.log('DB: getConversationsForUserBot - Found conversations:', conversations);
  return conversations;
};

// Fonction pour supprimer une conversation
const deleteConversation = (userId, botId, conversationId) => {
  // Supprimer l'entrée de la conversation de la table conversations
  // La suppression en cascade dans la table messages est gérée par la clé étrangère ON DELETE CASCADE
  const stmt = db.prepare(`
    DELETE FROM conversations 
    WHERE id = ? AND userId = ? AND botId = ?
  `);
  
  const result = stmt.run(conversationId, userId, botId);
  return result.changes > 0; // Indique si une ligne a été supprimée
};

// Nouvelle fonction pour mettre à jour le titre de la conversation (en modifiant le premier message)
const updateConversationTitle = (userId, botId, conversationId, title) => {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(`
        UPDATE conversations
        SET title = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND userId = ? AND botId = ?
      `);
      
      const result = stmt.run(title, conversationId, userId, botId);
      resolve(result.changes > 0);
    } catch (err) {
      console.error('Erreur lors de la mise à jour du titre de la conversation dans la base de données:', err);
      reject(err);
    }
  });
};

// Fonction pour rechercher des messages dans une conversation spécifique
const searchMessages = (userId, botId, conversationId, query) => {
  return new Promise((resolve, reject) => {
    try {
      // Utiliser LIKE pour la recherche insensible à la casse et ajouter des jokers pour une recherche partielle
      const searchTerm = `%${query.replace(/[\%_]/g, '\$&')}%`; // Échapper les caractères spéciaux SQL LIKE
      const stmt = db.prepare(`
        SELECT sender, text, timestamp
        FROM messages
        WHERE userId = ? AND botId = ? AND conversationId = ? AND text LIKE ? COLLATE NOCASE
        ORDER BY timestamp ASC
      `);
      
      const messages = stmt.all(userId, botId, conversationId, searchTerm);
      resolve(messages);
    } catch (err) {
      console.error('Erreur lors de la recherche de messages:', err);
      reject(err);
    }
  });
};

// Fonction pour ajouter une nouveau conversation
const addConversation = (userId, botId, title) => {
  const stmt = db.prepare(`
    INSERT INTO conversations (userId, botId, title)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(userId, botId, title);
  return result.lastInsertRowid;
};

// Fonction pour mettre à jour le statut d'une conversation
const updateConversationStatus = (userId, botId, conversationId, status) => {
  const stmt = db.prepare(`
    UPDATE conversations
    SET status = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ? AND userId = ? AND botId = ?
  `);
  const result = stmt.run(status, conversationId, userId, botId);
  return result.changes > 0;
};

// Fonction pour récupérer une conversation par son ID
const getConversationById = (conversationId) => {
  const stmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const conversation = stmt.get(conversationId);
  console.log('Fetching conversation by ID:', conversationId, '- Found:', conversation);
  return conversation;
};

// Nouvelle fonction pour sauvegarder les préférences utilisateur par bot
export function saveUserBotPreferences(userId, botId, preferences) {
  const existingPreference = db.prepare('SELECT * FROM user_bot_preferences WHERE userId = ? AND botId = ?').get(userId, botId);

  if (existingPreference) {
    // Mettre à jour si la préférence existe déjà
    const stmt = db.prepare(`
      UPDATE user_bot_preferences
      SET preferences = ?
      WHERE userId = ? AND botId = ?
    `);
    stmt.run(JSON.stringify(preferences), userId, botId);
    console.log(`Préférences utilisateur pour le bot ${botId} mises à jour pour l'utilisateur ${userId}.`);
  } else {
    // Insérer si la préférence n'existe pas
    const stmt = db.prepare(`
      INSERT INTO user_bot_preferences (userId, botId, preferences)
      VALUES (?, ?, ?)
    `);
    stmt.run(userId, botId, JSON.stringify(preferences));
    console.log(`Nouvelles préférences utilisateur pour le bot ${botId} enregistrées pour l'utilisateur ${userId}.`);
  }
}

// Nouvelle fonction pour récupérer les préférences utilisateur par bot
export function getUserBotPreferences(userId, botId) {
  const preference = db.prepare('SELECT preferences FROM user_bot_preferences WHERE userId = ? AND botId = ?').get(userId, botId);
  if (preference) {
    try {
      return JSON.parse(preference.preferences);
    } catch (e) {
      console.error(`Erreur lors du parsing des préférences pour l'utilisateur ${userId}, bot ${botId}:`, e);
      return null; // Retourner null en cas d'erreur de parsing
    }
  }
  return null; // Retourner null si aucune préférence n'est trouvée
}

export { 
  initDatabase, 
  findOrCreateUser, 
  findUserById, 
  getBots, 
  addMessage, 
  getMessagesForUserBot, 
  getBotById, 
  checkMessageLimit, 
  activateBotForUser, 
  getActivatedBotsForUser, 
  addActivationKey, 
  getConversationsForUserBot,
  deleteConversation,
  updateConversationTitle,
  searchMessages,
  addConversation,
  updateConversationStatus,
  getConversationById
}; 