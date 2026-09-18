<?php require_once $_SERVER["CEASAR"] . "/web/inc/branding.php"; ?>
<link rel="alternate icon" href="<?= tohtml(branding_asset_url("favicon")) ?>" type="image/png">
<link rel="icon" href="<?= tohtml(branding_asset_url("favicon")) ?>">
<link rel="stylesheet" href="/css/themes/default.min.css?<?= JS_LATEST_UPDATE ?>">

<?php
$selected_theme = !empty($_SESSION["userTheme"]) ? $_SESSION["userTheme"] : $_SESSION["THEME"];
// Load non-default theme
if ($selected_theme !== "default") {
	// Load Ceasar-shipped themes (minified, updated/overwritten with updates) - ($CEASAR/web/css/themes/*.min.css)
	$non_default_theme_path = $_SERVER["CEASAR"] . "/web/css/themes/" . $selected_theme . ".min.css";
	if (file_exists($non_default_theme_path)) {
		echo '<link rel="stylesheet" href="/css/themes/' . $selected_theme . ".min.css?" . JS_LATEST_UPDATE . '">';
	}
	// Load custom theme files ($CEASAR/web/css/themes/custom/*.css)
	else {
		$custom_theme_path = $_SERVER["CEASAR"] . "/web/css/themes/custom/" . $selected_theme . ".min.css";
		if (file_exists($custom_theme_path)) {
			echo '<link rel="stylesheet" href="/css/themes/custom/' . $selected_theme . ".min.css?" . JS_LATEST_UPDATE . '">';
		} else {
			echo '<link rel="stylesheet" href="/css/themes/custom/' . $selected_theme . ".css?" . JS_LATEST_UPDATE . '">';
		}
	}
}

?>
<style>:root { <?= branding_accent_style() ?> }</style>
