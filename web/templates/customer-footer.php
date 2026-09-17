		</main>
		<?php if (($customerPage ?? '') === 'account') { ?>
		<footer class="customer-footer">
			<div class="customer-footer-inner">
				<p>
					<span class="app-footer-link"><?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?></span>
					 · <a href="<?= htmlspecialchars((string) $config['terms_url'], ENT_QUOTES) ?>">Terms</a>
					 · <a href="<?= htmlspecialchars((string) $config['privacy_url'], ENT_QUOTES) ?>">Privacy</a>
				</p>
			</div>
		</footer>
		<?php } ?>
	</div>
</body>
</html>
