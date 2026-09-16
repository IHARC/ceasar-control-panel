<?php

declare(strict_types=1);

namespace Ceasar\System;

use function json_decode;

class CeasarCommandResult
{
    public function __construct(
        public readonly string $command,
        public readonly int $exitCode,
        public readonly string $output,
    ) {
    }

    public function getOutputJson(): array
    {
        return (array) json_decode($this->output, true, 512, JSON_THROW_ON_ERROR);
    }
}
