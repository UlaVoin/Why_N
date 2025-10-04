-- Создание базы данных
CREATE DATABASE IF NOT EXISTS users_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE users_db;

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
<<<<<<< Updated upstream
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
=======
    username VARCHAR() UNIQUE NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
>>>>>>> Stashed changes
