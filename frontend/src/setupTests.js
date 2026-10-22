// Loaded by react-scripts before every test file.
// jsdom (Jest 27) lacks TextEncoder/TextDecoder, which browsers and react-router 7 provide.
import { TextDecoder, TextEncoder } from 'util';

if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;
