import swaggerJSDoc from 'swagger-jsdoc';
import { env } from '../config/env';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Multi-Vendor Marketplace API',
      version: '1.0.0',
      description: 'Multi-location Food + Instamart + Delivery marketplace backend',
    },
    servers: [{ url: `/api/${env.API_VERSION}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/**/*.ts', './src/docs/**/*.yaml'],
};

export const swaggerSpec = swaggerJSDoc(options);
