<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/inc/customer.php';
customer_bootstrap();
customer_render('Customer sign in', 'login', [
    'config' => customer_config(),
    'customerPage' => 'login',
]);
