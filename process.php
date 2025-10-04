<?php
session_start(); // Запускаем сессию для передачи сообщений

// Подключение к БД (замени на свои данные)
$servername = "localhost";
$username_db = "root";  // Твой логин для MySQL
$password_db = "";      // Твой пароль для MySQL
$dbname = "users_db";

try {
    $pdo = new PDO("mysql:host=$servername;dbname=$dbname;charset=utf8", $username_db, $password_db);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch(PDOException $e) {
    die("Ошибка подключения: " . $e->getMessage());
}

// Получаем данные из формы
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $username = trim($_POST['username']);
    
    if (empty($username)) {
        $_SESSION['error'] = "Имя пользователя не может быть пустым!";
        header('Location: register.html');
        exit();
    }
    
    // Проверяем, существует ли уже такое имя
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$username]);
    
    if ($stmt->rowCount() > 0) {
        $_SESSION['error'] = "Пользователь с таким именем уже существует!";
        header('Location: register.html');
        exit();
    }
    
    // Вставляем в БД
    $stmt = $pdo->prepare("INSERT INTO users (username) VALUES (?)");
    $stmt->execute([$username]);
    
    $_SESSION['success'] = "Регистрация успешна! Пользователь '$username' добавлен.";
    header('Location: index.html');
    exit();
} else {
    die("Неверный метод запроса!");
}
?>