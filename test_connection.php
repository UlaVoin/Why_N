<?php
$servername = "localhost";
$username_db = "root";
$password_db = "";
$dbname = "users_db";
try {
    $pdo = new PDO("mysql:host=$servername;dbname=$dbname;charset=utf8", $username_db, $password_db);
    echo "Подключение успешно!";
} catch(PDOException $e) {
    echo "Ошибка: " . $e->getMessage();
}
?>