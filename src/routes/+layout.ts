/*
Sveltekit renders the page in the server this causes some errors with native browser objects like window, document, HTMLVideoElement etc.
This line of code is to tell sveltekit to not render the page in the server and only in the client.
*/
export const ssr = false;
