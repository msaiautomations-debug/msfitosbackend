const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const {
  listTrainers,
  createTrainer,
  updateTrainer,
  listTrainerAssignments,
  createTrainerAssignment,
  updateTrainerAssignment,
  deleteTrainerAssignment,
} = require('../controllers/trainersController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', listTrainers);
router.post('/', createTrainer);
router.put('/:id', updateTrainer);
router.get('/assignments', listTrainerAssignments);
router.post('/assignments', createTrainerAssignment);
router.put('/assignments/:id', updateTrainerAssignment);
router.delete('/assignments/:id', deleteTrainerAssignment);

module.exports = router;
