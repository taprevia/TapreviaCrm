/**
 * Model registry — imported by `connectDB()` to guarantee every Mongoose
 * model is registered on the connection before any query or `.populate()`
 * runs. This prevents MissingSchemaError on serverless cold starts, where a
 * route might .populate() a model it never imported directly.
 *
 * Each model file uses the cached pattern
 * (`mongoose.models.X || mongoose.model('X', Schema)`), so re-imports here
 * and in routes resolve to the same registered model.
 */
import './AdminAuditLog';
import './AnalyticsLog';
import './Appointment';
import './Card';
import './CatalogProduct';
import './Counter';
import './Inquiry';
import './Lead';
import './Media';
import './NewsletterSubscriber';
import './PasswordResetToken';
import './Product';
import './ProductEnquiry';
import './ProductTitleLog';
import './Profile';
import './RateCounter';
import './ReviewCategory';
import './ReviewTemplate';
import './Standee';
import './SystemSettings';
import './TenantSettings';
import './User';
import './UserProduct';

export {};